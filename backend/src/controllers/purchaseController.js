import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { logAudit } from '../services/auditService.js';
import { createLotForPurchase } from '../services/lotService.js';

function toDTO(p) {
  return {
    id: p._id,
    purchaseNumber: p.purchaseNumber,
    supplier: p.supplier,
    supplierName: p.supplierName,
    items: p.items.map((i) => ({
      item: i.item,
      name: i.itemName,
      quantity: i.quantity,
      unitCost: fromCents(i.unitCostCents),
      subtotal: fromCents(i.subtotalCents),
    })),
    totalCost: fromCents(p.totalCostCents),
    paidAmount: fromCents(p.paidAmountCents),
    balance: fromCents(p.balanceCents),
    purchaseDate: p.purchaseDate,
    notes: p.notes,
    status: p.status,
    createdAt: p.createdAt,
  };
}

async function generatePurchaseNumber(session) {
  const seq = await nextSequence('purchase', session);
  const year = new Date().getFullYear();
  return `PUR-${year}-${String(seq).padStart(6, '0')}`;
}

// POST /api/purchases
export const createPurchase = asyncHandler(async (req, res) => {
  const { supplierId, items, paidAmount = 0, purchaseDate, notes = '' } = req.body;

  if (!supplierId) throw new ApiError(400, 'Please select or create a supplier.');
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'Add at least one item to the purchase.');
  }
  for (const line of items) {
    if (!line.itemId) throw new ApiError(400, 'Each purchase line must reference a product.');
    if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) {
      throw new ApiError(400, 'Quantity must be greater than zero for every item.');
    }
    if (!Number.isFinite(Number(line.unitCost)) || Number(line.unitCost) < 0) {
      throw new ApiError(400, 'Unit cost must be a valid non-negative number.');
    }
  }

  const result = await runInTransaction(async (session) => {
    const supplier = await Supplier.findById(supplierId).session(session);
    if (!supplier) throw new ApiError(404, 'Supplier not found.');

    const purchaseItems = [];
    let totalCostCents = 0;

    for (const line of items) {
      const item = await InventoryItem.findById(line.itemId).session(session);
      if (!item) throw new ApiError(404, `Product not found (id: ${line.itemId}).`);

      const qty = Math.round(Number(line.quantity));
      const unitCostCents = toCents(line.unitCost);
      const subtotalCents = unitCostCents * qty;

      purchaseItems.push({
        item: item._id,
        itemName: item.name,
        quantity: qty,
        unitCostCents,
        subtotalCents,
      });

      totalCostCents += subtotalCents;

      item.quantity += qty;
      // Update cost price to the latest purchase cost so future sale profit
      // calculations reflect current sourcing cost. Past sales keep their
      // historical cost price untouched.
      item.costPriceCents = unitCostCents;
      if (line.updateSellingPrice && Number(line.sellingPrice) >= 0) {
        item.sellingPriceCents = toCents(line.sellingPrice);
      }
      await item.save({ session });
    }

    let paidAmountCents = toCents(paidAmount);
    if (paidAmountCents > totalCostCents) paidAmountCents = totalCostCents;
    const balanceCents = totalCostCents - paidAmountCents;

    const purchaseNumber = await generatePurchaseNumber(session);

    const [purchase] = await Purchase.create(
      [
        {
          purchaseNumber,
          supplier: supplier._id,
          supplierName: supplier.name,
          items: purchaseItems,
          totalCostCents,
          paidAmountCents,
          balanceCents,
          purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
          notes,
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    // One traceable lot per line, so supplier/item profitability reports can
    // always identify exactly which purchase produced a given unit of COGS.
    for (const line of purchaseItems) {
      await createLotForPurchase(
        { item: line.item, supplier: supplier._id, purchase: purchase._id, unitCostCents: line.unitCostCents, quantity: line.quantity },
        session
      );
    }

    supplier.totalSpentCents += totalCostCents;
    await supplier.save({ session });

    return purchase;
  });

  await logAudit({
    user: req.user,
    action: 'purchase.create',
    entityType: 'Purchase',
    entityId: result._id,
    details: { purchaseNumber: result.purchaseNumber, totalCost: fromCents(result.totalCostCents) },
  });

  res.status(201).json({ success: true, data: toDTO(result) });
});

export const listPurchases = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, from, to, range, supplier, status } = req.query;
  const filter = {};
  if (supplier) filter.supplier = supplier;
  if (status) filter.status = status;
  if (range || from || to) {
    const { start, end } = resolveDateRange({ range, from, to });
    filter.createdAt = { $gte: start, $lte: end };
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 20));

  const [items, total] = await Promise.all([
    Purchase.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Purchase.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map(toDTO),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

export const getPurchase = asyncHandler(async (req, res) => {
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) throw new ApiError(404, 'Purchase not found.');
  res.json({ success: true, data: toDTO(purchase) });
});

// POST /api/purchases/:id/void -- reverses stock increase (does not go below 0)
export const voidPurchase = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;

  const result = await runInTransaction(async (session) => {
    const purchase = await Purchase.findById(req.params.id).session(session);
    if (!purchase) throw new ApiError(404, 'Purchase not found.');
    if (purchase.status === 'voided') throw new ApiError(409, 'This purchase has already been voided.');

    const lots = await InventoryLot.find({ purchase: purchase._id }).session(session);
    for (const lot of lots) {
      if (lot.remainingQuantity < lot.originalQuantity) {
        throw new ApiError(
          409,
          `Cannot void this purchase: some of its stock has already been sold, so the original batch can no longer be fully reversed.`
        );
      }
    }

    for (const line of purchase.items) {
      const item = await InventoryItem.findById(line.item).session(session);
      if (item) {
        if (item.quantity < line.quantity) {
          throw new ApiError(
            409,
            `Cannot void: "${item.name}" stock (${item.quantity}) is lower than the purchased quantity (${line.quantity}), likely because some of it was already sold.`
          );
        }
        item.quantity -= line.quantity;
        await item.save({ session });
      }
    }

    await InventoryLot.deleteMany({ purchase: purchase._id }).session(session);

    const supplier = await Supplier.findById(purchase.supplier).session(session);
    if (supplier) {
      supplier.totalSpentCents -= purchase.totalCostCents;
      await supplier.save({ session });
    }

    purchase.status = 'voided';
    purchase.voidedAt = new Date();
    purchase.voidedReason = reason;
    await purchase.save({ session });

    return purchase;
  });

  await logAudit({
    user: req.user,
    action: 'purchase.void',
    entityType: 'Purchase',
    entityId: result._id,
    details: { reason },
  });

  res.json({ success: true, data: toDTO(result) });
});

export { toDTO as purchaseToDTO };

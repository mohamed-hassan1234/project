import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import InventoryItem from '../models/InventoryItem.js';
import Payment from '../models/Payment.js';
import CustomerLedger from '../models/CustomerLedger.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { logAudit } from '../services/auditService.js';
import { consumeLotsFIFO, restoreLotConsumption } from '../services/lotService.js';

function toDTO(sale) {
  return {
    id: sale._id,
    receiptNumber: sale.receiptNumber,
    customer: sale.customer,
    customerName: sale.customerName,
    items: sale.items.map((i) => ({
      item: i.item,
      name: i.itemName,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: fromCents(i.unitPriceCents),
      subtotal: fromCents(i.subtotalCents),
    })),
    subtotal: fromCents(sale.subtotalCents),
    discount: fromCents(sale.discountCents),
    total: fromCents(sale.totalCents),
    paidAmount: fromCents(sale.paidAmountCents),
    balanceAdded: fromCents(sale.balanceAddedCents),
    outstanding: fromCents(sale.outstandingCents),
    profit: fromCents(sale.profitCents),
    previousBalance: fromCents(sale.previousBalanceCents),
    newBalance: fromCents(sale.previousBalanceCents + sale.balanceAddedCents),
    status: sale.status,
    voidedReason: sale.voidedReason,
    createdAt: sale.createdAt,
  };
}

async function generateReceiptNumber(session) {
  const seq = await nextSequence('sale', session);
  const year = new Date().getFullYear();
  return `INV-${year}-${String(seq).padStart(6, '0')}`;
}

// POST /api/sales
export const createSale = asyncHandler(async (req, res) => {
  const { customerId, items, discount = 0, paidAmount = 0 } = req.body;

  if (!customerId) throw new ApiError(400, 'Please select or create a customer before completing the sale.');
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'Add at least one product to the sale.');
  }
  for (const line of items) {
    if (!line.itemId) throw new ApiError(400, 'Each sale line must reference a product.');
    if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) {
      throw new ApiError(400, 'Quantity must be greater than zero for every product.');
    }
  }
  if (Number(discount) < 0) throw new ApiError(400, 'Discount cannot be negative.');
  if (Number(paidAmount) < 0) throw new ApiError(400, 'Paid amount cannot be negative.');

  const result = await runInTransaction(async (session) => {
    const customer = await Customer.findById(customerId).session(session);
    if (!customer) throw new ApiError(404, 'Customer not found. Please select a valid customer.');

    const saleItems = [];
    let subtotalCents = 0;
    let costOfGoodsCents = 0;

    for (const line of items) {
      const item = await InventoryItem.findById(line.itemId).session(session);
      if (!item) throw new ApiError(404, `Product not found (id: ${line.itemId}).`);

      const qty = Math.round(Number(line.quantity));
      if (item.quantity < qty) {
        throw new ApiError(
          409,
          `Not enough stock for "${item.name}". Available: ${item.quantity}, requested: ${qty}.`
        );
      }

      const unitPriceCents = item.sellingPriceCents;
      const subtotalLineCents = unitPriceCents * qty;

      // Draw the sold units from the oldest purchase lots first (FIFO), so
      // COGS/profit for this line always reflects the real historical cost
      // of the exact units sold, traceable back to their supplier/purchase.
      const { breakdown, weightedUnitCostCents } = await consumeLotsFIFO(item, qty, session);
      const lineCostCents = breakdown.reduce((sum, b) => sum + b.quantity * b.unitCostCents, 0);

      saleItems.push({
        item: item._id,
        itemName: item.name,
        sku: item.sku,
        quantity: qty,
        unitPriceCents,
        costPriceCents: weightedUnitCostCents,
        subtotalCents: subtotalLineCents,
        lotConsumption: breakdown,
      });

      subtotalCents += subtotalLineCents;
      costOfGoodsCents += lineCostCents;

      item.quantity -= qty;
      await item.save({ session });
    }

    const discountCents = Math.min(toCents(discount), subtotalCents);
    const totalCents = subtotalCents - discountCents;
    let paidAmountCents = toCents(paidAmount);
    if (paidAmountCents > totalCents) paidAmountCents = totalCents; // overpayment not accepted here; use the debt payment flow for advance credit
    const balanceAddedCents = totalCents - paidAmountCents;
    const profitCents = totalCents - costOfGoodsCents;
    const previousBalanceCents = customer.balanceCents;

    const receiptNumber = await generateReceiptNumber(session);

    const [sale] = await Sale.create(
      [
        {
          receiptNumber,
          customer: customer._id,
          customerName: customer.name,
          items: saleItems,
          subtotalCents,
          discountCents,
          totalCents,
          paidAmountCents,
          balanceAddedCents,
          outstandingCents: balanceAddedCents,
          costOfGoodsCents,
          profitCents,
          previousBalanceCents,
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    customer.balanceCents += balanceAddedCents;
    customer.totalPurchasedCents += totalCents;
    customer.totalPaidCents += paidAmountCents;
    await customer.save({ session });

    if (paidAmountCents > 0) {
      await Payment.create(
        [
          {
            receiptNumber: `${receiptNumber}-PMT`,
            customer: customer._id,
            amountCents: paidAmountCents,
            type: 'sale',
            relatedSale: sale._id,
            previousBalanceCents,
            newBalanceCents: previousBalanceCents + balanceAddedCents,
            createdBy: req.user?._id,
          },
        ],
        { session }
      );
    }

    if (balanceAddedCents > 0) {
      await CustomerLedger.create(
        [
          {
            customer: customer._id,
            type: 'SALE_CREDIT',
            amountCents: balanceAddedCents,
            sale: sale._id,
            description: `Credit sale ${receiptNumber}`,
            balanceBeforeCents: previousBalanceCents,
            balanceAfterCents: previousBalanceCents + balanceAddedCents,
            createdBy: req.user?._id,
          },
        ],
        { session }
      );
    }

    return sale;
  });

  await logAudit({
    user: req.user,
    action: 'sale.create',
    entityType: 'Sale',
    entityId: result._id,
    details: { receiptNumber: result.receiptNumber, total: fromCents(result.totalCents) },
  });

  res.status(201).json({ success: true, data: toDTO(result) });
});

export const listSales = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, from, to, range, customer, status } = req.query;
  const filter = {};
  if (customer) filter.customer = customer;
  if (status) filter.status = status;
  if (range || from || to) {
    const { start, end } = resolveDateRange({ range, from, to });
    filter.createdAt = { $gte: start, $lte: end };
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 20));

  const [items, total] = await Promise.all([
    Sale.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Sale.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map(toDTO),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

export const getSale = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id).populate('customer', 'name phone');
  if (!sale) throw new ApiError(404, 'Sale not found.');
  res.json({ success: true, data: { ...toDTO(sale), customerPhone: sale.customer?.phone || '' } });
});

// GET /api/sales/:id/receipt -- data shaped for the printable A5 invoice
export const getReceipt = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id).populate('customer', 'name phone');
  if (!sale) throw new ApiError(404, 'Sale not found.');
  res.json({
    success: true,
    data: {
      ...toDTO(sale),
      customerPhone: sale.customer?.phone || '',
    },
  });
});

// POST /api/sales/:id/void
export const voidSale = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;

  const result = await runInTransaction(async (session) => {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) throw new ApiError(404, 'Sale not found.');
    if (sale.status === 'voided') throw new ApiError(409, 'This sale has already been voided.');
    if (sale.balanceAddedCents > 0 && sale.outstandingCents !== sale.balanceAddedCents) {
      throw new ApiError(
        409,
        'Cannot void this sale: a debt payment has already been applied to it. Reverse or reallocate that payment first.'
      );
    }

    for (const line of sale.items) {
      await InventoryItem.findByIdAndUpdate(line.item, { $inc: { quantity: line.quantity } }, { session });
      await restoreLotConsumption(line.lotConsumption, session);
    }

    const customer = await Customer.findById(sale.customer).session(session);
    if (customer) {
      const previousBalanceCents = customer.balanceCents;
      customer.balanceCents -= sale.balanceAddedCents;
      customer.totalPurchasedCents -= sale.totalCents;
      customer.totalPaidCents -= sale.paidAmountCents;
      await customer.save({ session });

      if (sale.balanceAddedCents > 0) {
        await CustomerLedger.create(
          [
            {
              customer: customer._id,
              type: 'SALE_VOID',
              amountCents: -sale.balanceAddedCents,
              sale: sale._id,
              description: `Voided sale ${sale.receiptNumber}${reason ? ` (${reason})` : ''}`,
              balanceBeforeCents: previousBalanceCents,
              balanceAfterCents: previousBalanceCents - sale.balanceAddedCents,
              createdBy: req.user?._id,
            },
          ],
          { session }
        );
      }
    }

    sale.status = 'voided';
    sale.voidedAt = new Date();
    sale.voidedReason = reason;
    sale.outstandingCents = 0;
    await sale.save({ session });

    return sale;
  });

  await logAudit({
    user: req.user,
    action: 'sale.void',
    entityType: 'Sale',
    entityId: result._id,
    details: { reason },
  });

  res.json({ success: true, data: toDTO(result) });
});

export { toDTO as saleToDTO };

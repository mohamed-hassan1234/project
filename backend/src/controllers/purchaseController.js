import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import Account from '../models/Account.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { logAudit } from '../services/auditService.js';
import { postImmediateTransaction } from '../services/accountService.js';

function toDTO(p) {
  return {
    id: p._id,
    purchaseNumber: p.purchaseNumber,
    supplierInvoiceNumber: p.supplierInvoiceNumber,
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
    paymentAccount: p.paymentAccount?._id || p.paymentAccount,
    paymentAccountName: p.paymentAccount?.name || '',
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

// POST /api/purchases -- purchase invoices are recorded and paid immediately
// (there is no Draft state for purchases). The payment account is required
// whenever anything is being paid now. The account is allowed to go negative
// -- a purchase is never rejected for insufficient balance, and the full
// amount always comes from the one selected account (never split across
// accounts or silently pulled from another one).
export const createPurchase = asyncHandler(async (req, res) => {
  const { supplierId, supplierInvoiceNumber = '', amount, purchaseAccountId } = req.body;
  if (typeof supplierInvoiceNumber !== 'string') throw new ApiError(400, 'Supplier invoice number must be text.');
  if (!supplierId) throw new ApiError(400, 'Please select or create a supplier.');
  if (!Number.isFinite(Number(amount)) || toCents(amount) <= 0) throw new ApiError(400, 'Amount must be greater than zero.');
  if (req.body.items?.length) throw new ApiError(400, 'Enter physical goods through Stock.');
  const result = await runInTransaction(async (session) => {
    const supplier = await Supplier.findById(supplierId).session(session);
    if (!supplier) throw new ApiError(404, 'Supplier not found.');
    const totalCostCents = toCents(amount);
    const paidAmountCents = totalCostCents;
    const balanceCents = 0;
    let account = null;
    if (paidAmountCents > 0) {
      if (!purchaseAccountId) throw new ApiError(400, 'Please select the account this purchase is being paid from.');
      account = await Account.findById(purchaseAccountId).session(session);
      if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');
      // Negative balances are allowed for purchase payments: the account is
      // debited for the full amount regardless of its current balance.
    }

    const purchaseNumber = await generatePurchaseNumber(session);

    const [purchase] = await Purchase.create(
      [
        {
          purchaseNumber,
          supplierInvoiceNumber: supplierInvoiceNumber.trim(),
          supplier: supplier._id,
          supplierName: supplier.name,
          items: [],
          totalCostCents,
          paidAmountCents,
          balanceCents,
          paymentAccount: account?._id || null,
          purchaseDate: new Date(),
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    if (account && paidAmountCents > 0) {
      const txn = await postImmediateTransaction(
        {
          account,
          direction: 'OUT',
          type: 'PURCHASE_PAYMENT',
          amountCents: paidAmountCents,
          referenceType: 'Purchase',
          referenceId: purchase._id,
          description: `Purchase invoice ${purchaseNumber} (${supplier.name})`,
          createdBy: req.user,
        },
        session
      );
      purchase.accountTransaction = txn?._id || null;
      await purchase.save({ session });
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
      .populate('paymentAccount', 'name')
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
  const purchase = await Purchase.findById(req.params.id).populate('paymentAccount', 'name');
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
      if (lot.remainingQuantity < lot.originalQuantity || lot.reservedQuantity > 0) {
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

    // Refund the money back into the account it was paid from, rather than
    // deleting that account's history.
    if (purchase.paymentAccount && purchase.paidAmountCents > 0) {
      const account = await Account.findById(purchase.paymentAccount).session(session);
      if (account) {
        await postImmediateTransaction(
          {
            account,
            direction: 'IN',
            type: 'REFUND',
            amountCents: purchase.paidAmountCents,
            referenceType: 'Purchase',
            referenceId: purchase._id,
            description: `Refund for voided purchase ${purchase.purchaseNumber}${reason ? ` (${reason})` : ''}`,
            createdBy: req.user,
          },
          session
        );
      }
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

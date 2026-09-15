import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import InventoryItem from '../models/InventoryItem.js';
import Account from '../models/Account.js';
import Payment from '../models/Payment.js';
import CustomerLedger from '../models/CustomerLedger.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { logAudit } from '../services/auditService.js';
import { restoreLotConsumption } from '../services/lotService.js';
import { reserveStock, releaseReservation } from '../services/stockService.js';
import { createPendingTransaction, reverseTransaction, postImmediateTransaction } from '../services/accountService.js';

function toDTO(sale) {
  return {
    id: sale._id,
    receiptNumber: sale.receiptNumber,
    // `customer`/`paymentAccount` are populated (objects) by getSale/getReceipt
    // but plain ObjectIds everywhere else -- always normalize to a bare id
    // string so callers never have to guess the shape.
    customer: sale.customer?._id || sale.customer,
    customerName: sale.customerName,
    items: sale.items.map((i) => ({
      item: i.item,
      name: i.itemName,
      itemCode: i.itemCode,
      serialNumber: i.serialNumber,
      quantity: i.quantity,
      unitPrice: fromCents(i.unitPriceCents),
      subtotal: fromCents(i.subtotalCents),
      allocations: i.lotConsumption,
      batchReservations: i.batchReservations,
    })),
    subtotal: fromCents(sale.subtotalCents),
    discount: fromCents(sale.discountCents),
    total: fromCents(sale.totalCents),
    paidAmount: fromCents(sale.paidAmountCents),
    paymentAccount: sale.paymentAccount?._id || sale.paymentAccount,
    balanceAdded: fromCents(sale.balanceAddedCents),
    outstanding: fromCents(sale.outstandingCents),
    profit: fromCents(sale.profitCents),
    previousBalance: fromCents(sale.previousBalanceCents),
    newBalance: fromCents(sale.previousBalanceCents + sale.balanceAddedCents),
    status: sale.status,
    confirmedAt: sale.confirmedAt,
    cancelledAt: sale.cancelledAt,
    cancelledReason: sale.cancelledReason,
    createdAt: sale.createdAt,
  };
}

async function generateReceiptNumber(session) {
  const seq = await nextSequence('sale', session);
  const year = new Date().getFullYear();
  return `INV-${year}-${String(seq).padStart(6, '0')}`;
}

function validateSaleItems({ items, discount, paidAmount }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'Add at least one product to the sale.');
  }
  for (const line of items) {
    if (!line.itemId) throw new ApiError(400, 'Each sale line must reference a product.');
    if (!Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) <= 0) {
      throw new ApiError(400, 'Quantity must be greater than zero for every product.');
    }
  }
  if (Number(discount) < 0) throw new ApiError(400, 'Discount cannot be negative.');
  if (Number(paidAmount) < 0) throw new ApiError(400, 'Paid amount cannot be negative.');
}

// POST /api/sales -- always creates a DRAFT/PENDING invoice. Stock is
// reserved (never physically deducted) and any payment is recorded as a
// PENDING account receipt. Nothing here touches customer balance, revenue,
// COGS, or profit -- those are only posted for real when Close Day confirms
// this invoice.
export const createSale = asyncHandler(async (req, res) => {
  const { customerId, items, discount = 0, paidAmount = 0, paymentAccountId } = req.body;
  if (!customerId) throw new ApiError(400, 'Please select or create a customer before completing the sale.');
  validateSaleItems({ items, discount, paidAmount });

  const result = await runInTransaction(async (session) => {
    const customer = await Customer.findById(customerId).session(session);
    if (!customer) throw new ApiError(404, 'Customer not found. Please select a valid customer.');

    let account = null;
    if (paymentAccountId) {
      account = await Account.findById(paymentAccountId).session(session);
      if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');
    }
    // Validated before any stock is reserved: runInTransaction falls back to
    // no session at all on a standalone (non-replica-set) MongoDB, so a
    // mid-function throw would NOT roll back reservations already applied.
    if (toCents(paidAmount) > 0 && !account) {
      throw new ApiError(400, 'Please select a payment account for the amount being paid.');
    }

    const saleItems = [];
    let subtotalCents = 0;

    for (const line of items) {
      const item = await InventoryItem.findById(line.itemId).session(session);
      if (!item) throw new ApiError(404, `Product not found (id: ${line.itemId}).`);

      const qty = Math.round(Number(line.quantity));
      const batchReservations = await reserveStock(item._id, qty, session);

      const unitPriceCents = item.sellingPriceCents;
      const subtotalLineCents = unitPriceCents * qty;

      saleItems.push({
        item: item._id,
        itemName: item.name,
        itemCode: item.itemCode,
        serialNumber: item.serialNumber,
        quantity: qty,
        unitPriceCents,
        costPriceCents: item.costPriceCents, // estimate; finalized at Close Day
        subtotalCents: subtotalLineCents,
        lotConsumption: [],
        batchReservations,
      });

      subtotalCents += subtotalLineCents;
    }

    const discountCents = Math.min(toCents(discount), subtotalCents);
    const totalCents = subtotalCents - discountCents;
    let paidAmountCents = toCents(paidAmount);
    if (paidAmountCents > totalCents) paidAmountCents = totalCents;

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
          paymentAccount: account?._id || null,
          balanceAddedCents: totalCents - paidAmountCents,
          outstandingCents: 0, // not posted until CONFIRMED
          costOfGoodsCents: 0,
          profitCents: 0,
          previousBalanceCents: customer.balanceCents, // snapshot for display only
          status: 'DRAFT',
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    if (paidAmountCents > 0 && account) {
      const txn = await createPendingTransaction(
        {
          account,
          direction: 'IN',
          type: 'SALE_PAYMENT',
          amountCents: paidAmountCents,
          referenceType: 'Sale',
          referenceId: sale._id,
          description: `Draft sale ${receiptNumber} (pending Close Day)`,
          createdBy: req.user,
        },
        session
      );
      sale.accountTransaction = txn?._id || null;
      await sale.save({ session });
    }

    return sale;
  });

  await logAudit({
    user: req.user,
    action: 'sale.create_draft',
    entityType: 'Sale',
    entityId: result._id,
    details: { receiptNumber: result.receiptNumber, total: fromCents(result.totalCents) },
  });

  res.status(201).json({ success: true, data: toDTO(result) });
});

// PUT /api/sales/:id -- same-day edit of a DRAFT invoice: items, quantities,
// discount, paid amount and payment account can all change. Reservations
// and the pending account receipt are recomputed from scratch each time.
export const updateSale = asyncHandler(async (req, res) => {
  const { items, discount = 0, paidAmount = 0, paymentAccountId } = req.body;
  validateSaleItems({ items, discount, paidAmount });

  const result = await runInTransaction(async (session) => {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) throw new ApiError(404, 'Sale not found.');
    if (sale.status !== 'DRAFT') {
      throw new ApiError(409, 'Only pending (Draft) invoices can be edited. This invoice has already been closed.');
    }

    let account = null;
    if (paymentAccountId) {
      account = await Account.findById(paymentAccountId).session(session);
      if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');
    }
    // Validated before anything is mutated: runInTransaction falls back to no
    // session at all on a standalone (non-replica-set) MongoDB, so a
    // mid-function throw would NOT roll back reservations already touched.
    if (toCents(paidAmount) > 0 && !account) {
      throw new ApiError(400, 'Please select a payment account for the amount being paid.');
    }

    // Release every existing reservation for this draft before re-reserving
    // against the new line items, so a removed/reduced line frees stock.
    for (const line of sale.items) {
      await releaseReservation(line.item, line.quantity, session, line.batchReservations);
    }
    if (sale.accountTransaction) {
      await reverseTransaction(sale.accountTransaction, session);
      sale.accountTransaction = null;
    }

    const saleItems = [];
    let subtotalCents = 0;
    for (const line of items) {
      const item = await InventoryItem.findById(line.itemId).session(session);
      if (!item) throw new ApiError(404, `Product not found (id: ${line.itemId}).`);
      const qty = Math.round(Number(line.quantity));
      const batchReservations = await reserveStock(item._id, qty, session);

      const unitPriceCents = item.sellingPriceCents;
      const subtotalLineCents = unitPriceCents * qty;
      saleItems.push({
        item: item._id,
        itemName: item.name,
        itemCode: item.itemCode,
        serialNumber: item.serialNumber,
        quantity: qty,
        unitPriceCents,
        costPriceCents: item.costPriceCents,
        subtotalCents: subtotalLineCents,
        lotConsumption: [],
        batchReservations,
      });
      subtotalCents += subtotalLineCents;
    }

    const discountCents = Math.min(toCents(discount), subtotalCents);
    const totalCents = subtotalCents - discountCents;
    let paidAmountCents = toCents(paidAmount);
    if (paidAmountCents > totalCents) paidAmountCents = totalCents;

    sale.items = saleItems;
    sale.subtotalCents = subtotalCents;
    sale.discountCents = discountCents;
    sale.totalCents = totalCents;
    sale.paidAmountCents = paidAmountCents;
    sale.paymentAccount = account?._id || null;
    sale.balanceAddedCents = totalCents - paidAmountCents;

    if (paidAmountCents > 0 && account) {
      const txn = await createPendingTransaction(
        {
          account,
          direction: 'IN',
          type: 'SALE_PAYMENT',
          amountCents: paidAmountCents,
          referenceType: 'Sale',
          referenceId: sale._id,
          description: `Draft sale ${sale.receiptNumber} (edited, pending Close Day)`,
          createdBy: req.user,
        },
        session
      );
      sale.accountTransaction = txn?._id || null;
    }

    await sale.save({ session });
    return sale;
  });

  await logAudit({
    user: req.user,
    action: 'sale.edit_draft',
    entityType: 'Sale',
    entityId: result._id,
    details: { receiptNumber: result.receiptNumber },
  });

  res.json({ success: true, data: toDTO(result) });
});

// POST /api/sales/:id/cancel -- cancels an entire DRAFT invoice. The
// document is kept (never deleted) so the audit trail is preserved; only
// its reservation and pending payment are released.
export const cancelSale = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;

  const result = await runInTransaction(async (session) => {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) throw new ApiError(404, 'Sale not found.');
    if (sale.status !== 'DRAFT') {
      throw new ApiError(409, 'Only pending (Draft) invoices can be cancelled directly. Use a return/reversal for a confirmed sale.');
    }

    for (const line of sale.items) {
      await releaseReservation(line.item, line.quantity, session, line.batchReservations);
    }
    if (sale.accountTransaction) {
      await reverseTransaction(sale.accountTransaction, session);
    }

    sale.status = 'CANCELLED';
    sale.cancelledAt = new Date();
    sale.cancelledReason = reason;
    await sale.save({ session });
    return sale;
  });

  await logAudit({
    user: req.user,
    action: 'sale.cancel_draft',
    entityType: 'Sale',
    entityId: result._id,
    details: { reason },
  });

  res.json({ success: true, data: toDTO(result) });
});

// GET /api/sales/drafts/today -- convenient Seller access to today's pending invoices
export const listTodayDrafts = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange({ range: 'today' });
  const drafts = await Sale.find({ status: 'DRAFT', createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 });
  res.json({ success: true, data: drafts.map(toDTO) });
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
  const sale = await Sale.findById(req.params.id).populate('customer', 'name phone').populate('paymentAccount', 'name');
  if (!sale) throw new ApiError(404, 'Sale not found.');
  res.json({ success: true, data: { ...toDTO(sale), customerPhone: sale.customer?.phone || '', paymentAccountName: sale.paymentAccount?.name || '' } });
});

// GET /api/sales/:id/receipt -- data shaped for the printable A5 invoice
export const getReceipt = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id).populate('customer', 'name phone').populate('paymentAccount', 'name');
  if (!sale) throw new ApiError(404, 'Sale not found.');
  res.json({
    success: true,
    data: {
      ...toDTO(sale),
      customerPhone: sale.customer?.phone || '',
      paymentAccountName: sale.paymentAccount?.name || '',
    },
  });
});

// POST /api/sales/:id/reverse -- for a CONFIRMED sale only (admin/manager).
// This is the authorized "return/reversal" path Close-Day-confirmed history
// requires instead of ever silently rewriting it: it reopens stock/lots,
// reverses the customer ledger, and posts an OUT account transaction if a
// payment had already been posted for this sale.
export const reverseSale = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;

  const result = await runInTransaction(async (session) => {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) throw new ApiError(404, 'Sale not found.');
    if (sale.status === 'DRAFT') throw new ApiError(409, 'This is still a Draft invoice -- cancel it instead of reversing it.');
    if (sale.status === 'CANCELLED') throw new ApiError(409, 'This sale has already been cancelled/reversed.');
    if (sale.balanceAddedCents > 0 && sale.outstandingCents !== sale.balanceAddedCents) {
      throw new ApiError(
        409,
        'Cannot reverse this sale: a debt payment has already been applied to it. Reverse or reallocate that payment first.'
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
              description: `Reversed sale ${sale.receiptNumber}${reason ? ` (${reason})` : ''}`,
              balanceBeforeCents: previousBalanceCents,
              balanceAfterCents: previousBalanceCents - sale.balanceAddedCents,
              createdBy: req.user?._id,
            },
          ],
          { session }
        );
      }
    }

    // The original payment was already POSTED at Close Day -- refund it out
    // of the same account rather than silently deleting that history.
    if (sale.paymentAccount && sale.paidAmountCents > 0) {
      const account = await Account.findById(sale.paymentAccount).session(session);
      if (account) {
        await postImmediateTransaction(
          {
            account,
            direction: 'OUT',
            type: 'REFUND',
            amountCents: sale.paidAmountCents,
            referenceType: 'Sale',
            referenceId: sale._id,
            description: `Refund for reversed sale ${sale.receiptNumber}${reason ? ` (${reason})` : ''}`,
            createdBy: req.user,
          },
          session
        );
      }
    }

    sale.status = 'CANCELLED';
    sale.cancelledAt = new Date();
    sale.cancelledReason = reason || 'Reversed after confirmation';
    sale.outstandingCents = 0;
    await sale.save({ session });

    return sale;
  });

  await logAudit({
    user: req.user,
    action: 'sale.reverse',
    entityType: 'Sale',
    entityId: result._id,
    details: { reason },
  });

  res.json({ success: true, data: toDTO(result) });
});

export { toDTO as saleToDTO };

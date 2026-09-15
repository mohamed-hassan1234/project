import Sale from '../models/Sale.js';
import InventoryItem from '../models/InventoryItem.js';
import Customer from '../models/Customer.js';
import Payment from '../models/Payment.js';
import CustomerLedger from '../models/CustomerLedger.js';
import Account from '../models/Account.js';
import DayClose from '../models/DayClose.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { consumeReservedBatches, reserveBatches } from './batchService.js';
import { confirmReservation } from './stockService.js';
import { postTransaction } from './accountService.js';
import { runInTransaction } from '../utils/transaction.js';

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function generatePaymentReceiptNumber(session) {
  const seq = await nextSequence('payment', session);
  const year = new Date().getFullYear();
  return `PAY-${year}-${String(seq).padStart(6, '0')}`;
}

// Read-only validation pass: every Draft must still reference a real
// customer, real items, and internally-consistent totals before Close Day
// is allowed to run. Returns a list of problems (empty = all clear).
export async function validateDraftsForClose(drafts) {
  const problems = [];
  for (const sale of drafts) {
    const issues = [];
    const customer = await Customer.findById(sale.customer);
    if (!customer) issues.push('Customer no longer exists.');
    for (const line of sale.items) {
      if (!line.item) issues.push(`Line "${line.itemName}" is missing its product reference.`);
      if (line.quantity <= 0) issues.push(`Line "${line.itemName}" has an invalid quantity.`);
    }
    const expectedTotal = sale.subtotalCents - sale.discountCents;
    if (expectedTotal !== sale.totalCents) issues.push('Invoice total does not match subtotal minus discount.');
    if (sale.paidAmountCents > sale.totalCents) issues.push('Paid amount exceeds the invoice total.');
    if (issues.length > 0) {
      problems.push({ saleId: sale._id, receiptNumber: sale.receiptNumber, issues });
    }
  }
  return problems;
}

// Builds the Close Day review screen: every outstanding Draft plus summary
// totals. Read-only -- never mutates anything.
export async function buildDayClosePreview() {
  const drafts = await Sale.find({ status: 'DRAFT' }).sort({ createdAt: 1 });
  const problems = await validateDraftsForClose(drafts);

  const totals = drafts.reduce(
    (acc, s) => {
      acc.totalValueCents += s.totalCents;
      acc.totalPaidCents += s.paidAmountCents;
      acc.totalReservedUnits += s.items.reduce((sum, i) => sum + i.quantity, 0);
      return acc;
    },
    { totalValueCents: 0, totalPaidCents: 0, totalReservedUnits: 0 }
  );

  return { drafts, problems, totals, readyToConfirm: problems.length === 0 && drafts.length > 0 };
}

// The Close Day process itself. Confirms every valid Draft sale: converts
// its stock reservation into a permanent deduction, runs real FIFO lot
// consumption for historical COGS, posts revenue/COGS/profit, posts the
// customer's debt/payment, and posts its pending account transaction.
// Wrapped in a single Mongo transaction so nothing can half-apply.
export async function closeDay({ user } = {}) {
  const drafts = await Sale.find({ status: 'DRAFT' }).sort({ createdAt: 1 });
  if (drafts.length === 0) {
    throw new ApiError(409, 'There are no pending draft invoices to close.');
  }

  const problems = await validateDraftsForClose(drafts);
  if (problems.length > 0) {
    throw new ApiError(409, 'Some draft invoices are not valid and must be fixed before closing the day.', { problems });
  }

  const businessDate = startOfDay();

  const result = await runInTransaction(async (session) => {
    let revenueCents = 0;
    let cogsCents = 0;
    let grossProfitCents = 0;
    let cashCollectedCents = 0;
    let customerCreditCents = 0;
    const paymentBreakdownMap = new Map(); // accountId -> { accountName, amountCents }
    const confirmedSales = [];

    const currentDrafts = await Sale.find({ status: 'DRAFT' }).sort({ createdAt: 1 }).session(session);
    if (!currentDrafts.length) throw new ApiError(409, 'Drafts were already closed.');
    for (const sale of currentDrafts) {
      // 1. Convert reservation into a permanent stock deduction and run
      // real FIFO consumption so COGS/profit reflect actual purchase cost.
      let costOfGoodsCents = 0;
      for (const line of sale.items) {
        const itemDoc = await InventoryItem.findById(line.item).session(session);
        if (!line.batchReservations?.length) line.batchReservations = await reserveBatches(itemDoc, line.quantity, session);
        const { breakdown, weightedUnitCostCents } = await consumeReservedBatches(line.batchReservations, session);
        await confirmReservation(line.item, line.quantity, session, sale.receiptNumber);
        line.costPriceCents = weightedUnitCostCents;
        line.lotConsumption = breakdown;
        costOfGoodsCents += breakdown.reduce((sum, b) => sum + b.quantity * b.unitCostCents, 0);
      }

      const profitCents = sale.totalCents - costOfGoodsCents;

      // 2. Post customer debt/payment (deferred until now on purpose).
      const customer = await Customer.findById(sale.customer).session(session);
      const previousBalanceCents = customer.balanceCents;
      const balanceAddedCents = sale.totalCents - sale.paidAmountCents;

      customer.balanceCents += balanceAddedCents;
      customer.totalPurchasedCents += sale.totalCents;
      customer.totalPaidCents += sale.paidAmountCents;
      await customer.save({ session });

      if (sale.paidAmountCents > 0) {
        const receiptNumber = await generatePaymentReceiptNumber(session);
        await Payment.create(
          [
            {
              receiptNumber,
              customer: customer._id,
              amountCents: sale.paidAmountCents,
              type: 'sale',
              relatedSale: sale._id,
              previousBalanceCents,
              newBalanceCents: previousBalanceCents + balanceAddedCents,
              createdBy: sale.createdBy,
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
              description: `Credit sale ${sale.receiptNumber}`,
              balanceBeforeCents: previousBalanceCents,
              balanceAfterCents: previousBalanceCents + balanceAddedCents,
              createdBy: sale.createdBy,
            },
          ],
          { session }
        );
      }

      // 3. Post the pending account transaction (money actually moves now).
      if (sale.accountTransaction) {
        const txn = await postTransaction(sale.accountTransaction, session);
        if (txn) {
          const key = String(txn.account);
          const account = await Account.findById(txn.account).session(session);
          const existing = paymentBreakdownMap.get(key) || { account: txn.account, accountName: account?.name || 'Account', amountCents: 0 };
          existing.amountCents += txn.amountCents;
          paymentBreakdownMap.set(key, existing);
        }
      }

      // 4. Finalize the sale document itself.
      sale.costOfGoodsCents = costOfGoodsCents;
      sale.profitCents = profitCents;
      sale.previousBalanceCents = previousBalanceCents;
      sale.balanceAddedCents = balanceAddedCents;
      sale.outstandingCents = balanceAddedCents;
      sale.status = 'CONFIRMED';
      sale.confirmedAt = new Date();
      await sale.save({ session });

      revenueCents += sale.totalCents;
      cogsCents += costOfGoodsCents;
      grossProfitCents += profitCents;
      cashCollectedCents += sale.paidAmountCents;
      customerCreditCents += balanceAddedCents;
      confirmedSales.push(sale);
    }

    const paymentBreakdown = Array.from(paymentBreakdownMap.values());

    const dayClose = await DayClose.findOneAndUpdate(
      { businessDate },
      {
        $inc: {
          invoiceCount: confirmedSales.length,
          revenueCents,
          cogsCents,
          grossProfitCents,
          cashCollectedCents,
          customerCreditCents,
        },
        $set: { closedBy: user?._id || null, closedByName: user?.name || 'system', closedAt: new Date() },
        $setOnInsert: { businessDate },
      },
      { upsert: true, new: true, session }
    );

    // Merge payment breakdown across possibly-repeated closes of the same day.
    const mergedBreakdown = new Map((dayClose.paymentBreakdown || []).map((p) => [String(p.account), { ...p.toObject?.() ?? p }]));
    for (const p of paymentBreakdown) {
      const key = String(p.account);
      const existing = mergedBreakdown.get(key);
      if (existing) existing.amountCents = (existing.amountCents || 0) + p.amountCents;
      else mergedBreakdown.set(key, p);
    }
    dayClose.paymentBreakdown = Array.from(mergedBreakdown.values());
    await dayClose.save({ session });

    return { dayClose, confirmedSales };
  });

  return result;
}

export async function getDayCloseHistory({ page = 1, limit = 20 } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const [items, total] = await Promise.all([
    DayClose.find()
      .sort({ businessDate: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    DayClose.countDocuments(),
  ]);
  return { items, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } };
}

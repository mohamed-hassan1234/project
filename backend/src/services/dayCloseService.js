import Sale from '../models/Sale.js';
import InventoryItem from '../models/InventoryItem.js';
import Customer from '../models/Customer.js';
import Payment from '../models/Payment.js';
import CustomerLedger from '../models/CustomerLedger.js';
import Account from '../models/Account.js';
import DayClose from '../models/DayClose.js';
import BusinessDay from '../models/BusinessDay.js';
import User from '../models/User.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { consumeReservedBatches, reserveBatches } from './batchService.js';
import { confirmReservation } from './stockService.js';
import { postTransaction, postImmediateTransaction } from './accountService.js';
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

// Live OPEN/CLOSED switch that saleService.createSaleDraft checks on every
// new sale. Defaults to OPEN and lazily creates the singleton document so
// an existing deployment upgrading to this feature never finds POS
// unexpectedly locked just because the record doesn't exist yet.
export async function getBusinessDayStatus() {
  let bd = await BusinessDay.findById('current');
  if (!bd) {
    bd = await BusinessDay.create({ _id: 'current', status: 'OPEN', businessDate: startOfDay(), openedAt: new Date() });
  }
  return bd;
}

// Admin-only: reopens Seller/POS after a Close Day. Does not touch DayClose
// history or Account balances -- accounts are already at $0 from the close
// that preceded this, which is exactly the state the next session should
// start from.
export async function openDay({ user } = {}) {
  const bd = await getBusinessDayStatus();
  if (bd.status === 'OPEN') throw new ApiError(409, 'The day is already open.');
  bd.status = 'OPEN';
  bd.businessDate = startOfDay();
  bd.openedAt = new Date();
  bd.openedBy = user?._id || null;
  bd.openedByName = user?.name || 'system';
  await bd.save();
  return bd;
}

// Zeroes every active Account with a non-zero balance, posting one
// auditable ADJUSTMENT transaction per account (never a silent overwrite)
// so the ledger fully explains why the balance moved. Returns the
// pre-reset balances for the DayClose snapshot to preserve permanently.
async function resetOperationalAccounts(session, user) {
  const accounts = await Account.find({ isActive: true }).session(session);
  const before = [];
  for (const account of accounts) {
    if (account.currentBalanceCents === 0) continue;
    before.push({ account: account._id, accountName: account.name, balanceBeforeResetCents: account.currentBalanceCents });
    const direction = account.currentBalanceCents > 0 ? 'OUT' : 'IN';
    const amountCents = Math.abs(account.currentBalanceCents);
    await postImmediateTransaction(
      {
        account,
        direction,
        type: 'ADJUSTMENT',
        amountCents,
        referenceType: 'Manual',
        referenceId: null,
        description: `Close Day reset (${startOfDay().toDateString()})`,
        createdBy: user,
      },
      session
    );
  }
  return before;
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
    if (sale.paidAmountCents + sale.walletAmountCents > sale.totalCents) issues.push('Paid amount plus wallet amount exceeds the invoice total.');
    if (issues.length > 0) {
      problems.push({ saleId: sale._id, receiptNumber: sale.receiptNumber, issues });
    }
  }
  return problems;
}

// Builds the Close Day review screen: every outstanding Draft plus summary
// totals, plus today's payment/cashier breakdown computed from already-
// PENDING account receipts (nothing posted yet -- this is a preview).
// Read-only -- never mutates anything.
export async function buildDayClosePreview() {
  const drafts = await Sale.find({ status: 'DRAFT' }).sort({ createdAt: 1 }).populate('paymentAccount', 'name').populate('createdBy', 'name');
  const problems = await validateDraftsForClose(drafts);
  const businessDay = await getBusinessDayStatus();

  const totals = drafts.reduce(
    (acc, s) => {
      acc.totalValueCents += s.totalCents;
      acc.totalPaidCents += s.paidAmountCents;
      acc.totalReservedUnits += s.items.reduce((sum, i) => sum + i.quantity, 0);
      return acc;
    },
    { totalValueCents: 0, totalPaidCents: 0, totalReservedUnits: 0 }
  );

  // Payments Breakdown by Account, and by Cashier/User -- from pending
  // (not-yet-posted) receipts on today's drafts, so the admin can see what
  // Close Day is about to post before confirming.
  const byAccount = new Map();
  const byCashier = new Map();
  for (const s of drafts) {
    if (s.paidAmountCents <= 0 || !s.paymentAccount) continue;
    const accId = String(s.paymentAccount._id || s.paymentAccount);
    const accName = s.paymentAccount.name || 'Account';
    const acc = byAccount.get(accId) || { account: accId, accountName: accName, amountCents: 0 };
    acc.amountCents += s.paidAmountCents;
    byAccount.set(accId, acc);

    const userId = String(s.createdBy?._id || s.createdBy || 'unknown');
    const userName = s.createdBy?.name || 'Unknown';
    const cashier = byCashier.get(userId) || { user: userId, userName, byAccount: new Map(), totalCents: 0 };
    const cashierAcc = cashier.byAccount.get(accId) || { account: accId, accountName: accName, amountCents: 0 };
    cashierAcc.amountCents += s.paidAmountCents;
    cashier.byAccount.set(accId, cashierAcc);
    cashier.totalCents += s.paidAmountCents;
    byCashier.set(userId, cashier);
  }

  return {
    drafts,
    problems,
    totals,
    readyToConfirm: problems.length === 0,
    businessDay,
    paymentBreakdown: Array.from(byAccount.values()),
    cashierBreakdown: Array.from(byCashier.values()).map((c) => ({ ...c, byAccount: Array.from(c.byAccount.values()) })),
  };
}

// The Close Day process itself. Confirms every valid Draft sale: converts
// its stock reservation into a permanent deduction, runs real FIFO lot
// consumption for historical COGS, posts revenue/COGS/profit, posts the
// customer's debt/payment, and posts its pending account transaction. Then
// resets every operational Account to $0 (with a full audit trail) and
// closes the business day. Wrapped in a single Mongo transaction so
// nothing can half-apply.
export async function closeDay({ user } = {}) {
  const businessDay = await getBusinessDayStatus();
  if (businessDay.status === 'CLOSED') {
    throw new ApiError(409, 'The day is already closed. Open the day before closing it again.');
  }

  const drafts = await Sale.find({ status: 'DRAFT' }).sort({ createdAt: 1 });
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
    const cashierBreakdownMap = new Map(); // userId -> { userName, byAccount: Map, totalCents }
    const userNameCache = new Map();
    const invoiceReferences = [];
    const confirmedSales = [];

    const bd = await BusinessDay.findById('current').session(session);
    if (bd && bd.status === 'CLOSED') throw new ApiError(409, 'The day was already closed.');

    const currentDrafts = await Sale.find({ status: 'DRAFT' }).sort({ createdAt: 1 }).session(session);
    for (const sale of currentDrafts) {
      // 1. Convert reservation into a permanent stock deduction. Lots are
      // still consumed oldest/nearest-expiry-first (FEFO) for physical
      // traceability -- which supplier/purchase/expiry each unit came from
      // -- but that is now a traceability concern only. The line's
      // historical accounting cost is the item's Weighted Average Cost (WAC)
      // at this exact moment, snapshotted here and never touched again: a
      // normal sale/stock-out does not change WAC (Phase 12), so this
      // invoice's cost/profit stays correct forever even after later
      // purchases move the item's average cost.
      let costOfGoodsCents = 0;
      for (const line of sale.items) {
        const itemDoc = await InventoryItem.findById(line.item).session(session);
        if (!line.batchReservations?.length) line.batchReservations = await reserveBatches(itemDoc, line.quantity, session);
        const { breakdown } = await consumeReservedBatches(line.batchReservations, session);
        await confirmReservation(line.item, line.quantity, session, sale.receiptNumber);
        line.costPriceCents = itemDoc.costPriceCents; // WAC snapshot -- authoritative historical COGS basis
        line.lotConsumption = breakdown; // lot/expiry/supplier traceability only, no longer the cost basis
        costOfGoodsCents += line.quantity * itemDoc.costPriceCents;
      }

      const profitCents = sale.totalCents - costOfGoodsCents;

      // 2. Post customer debt/payment (deferred until now on purpose).
      const customer = await Customer.findById(sale.customer).session(session);
      const previousBalanceCents = customer.balanceCents;
      // Wallet credit was already debited immediately at Draft creation/edit
      // (see saleService.debitWallet) -- it reduces what's owed here exactly
      // like paidAmountCents does, but never posts a new Account receipt.
      const balanceAddedCents = sale.totalCents - sale.paidAmountCents - sale.walletAmountCents;

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

      // 3. Post the pending account transaction (money actually moves now)
      // and attribute it to both the Account and the cashier who took it.
      if (sale.accountTransaction) {
        const txn = await postTransaction(sale.accountTransaction, session);
        if (txn) {
          const accKey = String(txn.account);
          const account = await Account.findById(txn.account).session(session);
          const existingAcc = paymentBreakdownMap.get(accKey) || { account: txn.account, accountName: account?.name || 'Account', amountCents: 0 };
          existingAcc.amountCents += txn.amountCents;
          paymentBreakdownMap.set(accKey, existingAcc);

          const userKey = String(sale.createdBy || 'unknown');
          if (!userNameCache.has(userKey) && sale.createdBy) {
            const u = await User.findById(sale.createdBy).session(session);
            userNameCache.set(userKey, u?.name || 'Unknown');
          }
          const cashier = cashierBreakdownMap.get(userKey) || {
            user: sale.createdBy || null,
            userName: userNameCache.get(userKey) || 'Unknown',
            byAccount: new Map(),
            totalCents: 0,
          };
          const cashierAcc = cashier.byAccount.get(accKey) || { account: txn.account, accountName: account?.name || 'Account', amountCents: 0 };
          cashierAcc.amountCents += txn.amountCents;
          cashier.byAccount.set(accKey, cashierAcc);
          cashier.totalCents += txn.amountCents;
          cashierBreakdownMap.set(userKey, cashier);
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
      invoiceReferences.push(sale.receiptNumber);
      confirmedSales.push(sale);
    }

    // 5. Reset every operational Account to $0 -- with a full audit trail,
    // capturing what each one held immediately before the reset.
    const accountBalancesBeforeReset = await resetOperationalAccounts(session, user);

    const paymentBreakdown = Array.from(paymentBreakdownMap.values());
    const cashierBreakdown = Array.from(cashierBreakdownMap.values()).map((c) => ({ ...c, byAccount: Array.from(c.byAccount.values()) }));

    const [dayClose] = await DayClose.create(
      [
        {
          businessDate,
          invoiceCount: confirmedSales.length,
          revenueCents,
          cogsCents,
          grossProfitCents,
          cashCollectedCents,
          customerCreditCents,
          paymentBreakdown,
          cashierBreakdown,
          accountBalancesBeforeReset,
          invoiceReferences,
          openedAt: bd?.openedAt || null,
          closedBy: user?._id || null,
          closedByName: user?.name || 'system',
          closedAt: new Date(),
        },
      ],
      { session }
    );

    // 6. Flip the business day to CLOSED.
    await BusinessDay.findByIdAndUpdate(
      'current',
      {
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: user?._id || null,
        closedByName: user?.name || 'system',
        lastDayClose: dayClose._id,
      },
      { upsert: true, session }
    );

    return { dayClose, confirmedSales };
  });

  return result;
}

export async function getDayCloseHistory({ page = 1, limit = 20 } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const [items, total] = await Promise.all([
    DayClose.find()
      .sort({ businessDate: -1, closedAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    DayClose.countDocuments(),
  ]);
  return { items, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } };
}

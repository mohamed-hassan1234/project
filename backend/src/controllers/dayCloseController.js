import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';
import { logAudit } from '../services/auditService.js';
import { buildDayClosePreview, closeDay, getDayCloseHistory } from '../services/dayCloseService.js';
import { saleToDTO } from './saleController.js';

// GET /api/day-close/preview -- the review screen shown before actually closing
export const getPreview = asyncHandler(async (req, res) => {
  const { drafts, problems, totals, readyToConfirm } = await buildDayClosePreview();

  res.json({
    success: true,
    data: {
      date: new Date(),
      invoices: drafts.map(saleToDTO),
      totalDraftInvoices: drafts.length,
      totalDraftValue: fromCents(totals.totalValueCents),
      totalPaymentsReceived: fromCents(totals.totalPaidCents),
      totalReservedUnits: totals.totalReservedUnits,
      problems,
      readyToConfirm,
    },
  });
});

// POST /api/day-close/confirm -- the actual Close Day action, requires
// explicit confirmation from the client (there is no auto-close on a timer).
export const confirmClose = asyncHandler(async (req, res) => {
  const { dayClose, confirmedSales } = await closeDay({ user: req.user });

  await logAudit({
    user: req.user,
    action: 'dayclose.confirm',
    entityType: 'DayClose',
    entityId: dayClose._id,
    details: { invoiceCount: confirmedSales.length, revenue: fromCents(dayClose.revenueCents) },
  });

  res.status(201).json({
    success: true,
    data: {
      id: dayClose._id,
      businessDate: dayClose.businessDate,
      invoiceCount: dayClose.invoiceCount,
      revenue: fromCents(dayClose.revenueCents),
      cogs: fromCents(dayClose.cogsCents),
      grossProfit: fromCents(dayClose.grossProfitCents),
      cashCollected: fromCents(dayClose.cashCollectedCents),
      customerCredit: fromCents(dayClose.customerCreditCents),
      paymentBreakdown: dayClose.paymentBreakdown.map((p) => ({ account: p.account, accountName: p.accountName, amount: fromCents(p.amountCents) })),
      closedByName: dayClose.closedByName,
      closedAt: dayClose.closedAt,
      confirmedInvoices: confirmedSales.map(saleToDTO),
    },
  });
});

// GET /api/day-close/history
export const listHistory = asyncHandler(async (req, res) => {
  const { items, pagination } = await getDayCloseHistory(req.query);
  res.json({
    success: true,
    data: items.map((d) => ({
      id: d._id,
      businessDate: d.businessDate,
      invoiceCount: d.invoiceCount,
      revenue: fromCents(d.revenueCents),
      cogs: fromCents(d.cogsCents),
      grossProfit: fromCents(d.grossProfitCents),
      cashCollected: fromCents(d.cashCollectedCents),
      customerCredit: fromCents(d.customerCreditCents),
      paymentBreakdown: d.paymentBreakdown.map((p) => ({ account: p.account, accountName: p.accountName, amount: fromCents(p.amountCents) })),
      closedByName: d.closedByName,
      closedAt: d.closedAt,
    })),
    pagination,
  });
});

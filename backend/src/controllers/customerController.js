import Customer from '../models/Customer.js';
import Sale from '../models/Sale.js';
import Payment from '../models/Payment.js';
import CustomerLedger from '../models/CustomerLedger.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { logAudit } from '../services/auditService.js';

function toDTO(c) {
  return {
    id: c._id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    address: c.address,
    notes: c.notes,
    balance: fromCents(c.balanceCents),
    totalPurchased: fromCents(c.totalPurchasedCents),
    totalPaid: fromCents(c.totalPaidCents),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function generatePaymentReceiptNumber(session) {
  const seq = await nextSequence('payment', session);
  const year = new Date().getFullYear();
  return `PAY-${year}-${String(seq).padStart(6, '0')}`;
}

// GET /api/customers?search=&page=&limit=
export const listCustomers = asyncHandler(async (req, res) => {
  const { search = '', page = 1, limit = 20 } = req.query;
  const filter = {};
  if (search.trim()) {
    const norm = Customer.normalize(search);
    filter.$or = [
      { normalizedName: { $regex: norm, $options: 'i' } },
      { phone: { $regex: search.trim(), $options: 'i' } },
    ];
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const [items, total] = await Promise.all([
    Customer.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Customer.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map(toDTO),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

// GET /api/customers/search?q=Ahmed  -- fast lightweight search used by POS
export const searchCustomers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, data: [] });

  const norm = Customer.normalize(q);
  const customers = await Customer.find({
    $or: [{ normalizedName: { $regex: norm, $options: 'i' } }, { phone: { $regex: q, $options: 'i' } }],
  })
    .sort({ name: 1 })
    .limit(10);

  res.json({ success: true, data: customers.map(toDTO) });
});

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');
  res.json({ success: true, data: toDTO(customer) });
});

export const createCustomer = asyncHandler(async (req, res) => {
  const { name, phone = '', email = '', address = '', openingBalance = 0, notes = '' } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Customer name is required.');

  const openingBalanceCents = toCents(openingBalance);
  const customer = await Customer.create({
    name: name.trim(),
    phone: phone.trim(),
    email: email.trim(),
    address: address.trim(),
    notes,
    openingBalanceCents,
    balanceCents: openingBalanceCents,
  });

  if (openingBalanceCents > 0) {
    await CustomerLedger.create({
      customer: customer._id,
      type: 'ADJUSTMENT',
      amountCents: openingBalanceCents,
      description: 'Opening balance',
      balanceBeforeCents: 0,
      balanceAfterCents: openingBalanceCents,
      createdBy: req.user?._id,
    });
  }

  await logAudit({
    user: req.user,
    action: 'customer.create',
    entityType: 'Customer',
    entityId: customer._id,
    details: { name: customer.name },
  });

  res.status(201).json({ success: true, data: toDTO(customer) });
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const { name, phone, email, address, notes } = req.body;
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Customer name cannot be empty.');
    customer.name = name.trim();
  }
  if (phone !== undefined) customer.phone = phone.trim();
  if (email !== undefined) customer.email = email.trim();
  if (address !== undefined) customer.address = address.trim();
  if (notes !== undefined) customer.notes = notes;

  await customer.save();

  await logAudit({
    user: req.user,
    action: 'customer.update',
    entityType: 'Customer',
    entityId: customer._id,
    details: req.body,
  });

  res.json({ success: true, data: toDTO(customer) });
});

export const deleteCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const saleCount = await Sale.countDocuments({ customer: customer._id, status: 'completed' });
  if (saleCount > 0) {
    throw new ApiError(
      409,
      'This customer has sales history and cannot be deleted. Consider editing their details instead.'
    );
  }

  await customer.deleteOne();

  await logAudit({
    user: req.user,
    action: 'customer.delete',
    entityType: 'Customer',
    entityId: customer._id,
    details: { name: customer.name },
  });

  res.json({ success: true, data: { id: req.params.id } });
});

// GET /api/customers/:id/history  -- full transaction history + ledger timeline
export const getCustomerHistory = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const { from, to } = req.query;
  const filter = { customer: customer._id };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const sales = await Sale.find(filter).sort({ createdAt: -1 });
  const payments = await Payment.find({ customer: customer._id, type: { $ne: 'sale' } })
    .sort({ createdAt: -1 });
  const ledger = await CustomerLedger.find({ customer: customer._id }).sort({ createdAt: 1 });

  res.json({
    success: true,
    data: {
      customer: toDTO(customer),
      sales: sales.map((s) => ({
        id: s._id,
        receiptNumber: s.receiptNumber,
        status: s.status,
        items: s.items.map((i) => ({
          name: i.itemName,
          quantity: i.quantity,
          unitPrice: fromCents(i.unitPriceCents),
          subtotal: fromCents(i.subtotalCents),
        })),
        subtotal: fromCents(s.subtotalCents),
        discount: fromCents(s.discountCents),
        total: fromCents(s.totalCents),
        paidAmount: fromCents(s.paidAmountCents),
        balanceAdded: fromCents(s.balanceAddedCents),
        outstanding: fromCents(s.outstandingCents),
        createdAt: s.createdAt,
      })),
      payments: payments.map((p) => ({
        id: p._id,
        receiptNumber: p.receiptNumber,
        amount: fromCents(p.amountCents),
        type: p.type,
        allocations: p.allocations.map((a) => ({ receiptNumber: a.receiptNumber, amount: fromCents(a.amountCents) })),
        notes: p.notes,
        createdAt: p.createdAt,
      })),
      timeline: ledger.map((l) => ({
        id: l._id,
        type: l.type,
        amount: fromCents(l.amountCents),
        description: l.description,
        balanceBefore: fromCents(l.balanceBeforeCents),
        balanceAfter: fromCents(l.balanceAfterCents),
        sale: l.sale,
        payment: l.payment,
        createdAt: l.createdAt,
      })),
    },
  });
});

// GET /api/customers/:id/debt -- outstanding invoices this customer still owes on
export const getCustomerDebt = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const invoices = await Sale.find({ customer: customer._id, status: 'completed', outstandingCents: { $gt: 0 } })
    .sort({ createdAt: 1 })
    .select('receiptNumber totalCents paidAmountCents outstandingCents createdAt');

  const totalOutstandingCents = invoices.reduce((sum, i) => sum + i.outstandingCents, 0);

  res.json({
    success: true,
    data: {
      customer: toDTO(customer),
      totalOutstanding: fromCents(totalOutstandingCents),
      invoices: invoices.map((i) => ({
        id: i._id,
        receiptNumber: i.receiptNumber,
        total: fromCents(i.totalCents),
        paidAtSale: fromCents(i.paidAmountCents),
        outstanding: fromCents(i.outstandingCents),
        createdAt: i.createdAt,
      })),
    },
  });
});

// POST /api/customers/:id/payments  -- pay down debt, allocated to specific invoices
export const payCustomerDebt = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) throw new ApiError(400, 'Please enter a valid payment amount.');
  const amountCents = toCents(amount);
  const requestedAllocations = Array.isArray(req.body.allocations) ? req.body.allocations : null;

  const result = await runInTransaction(async (session) => {
    const customer = await Customer.findById(req.params.id).session(session);
    if (!customer) throw new ApiError(404, 'Customer not found.');

    const outstandingInvoices = await Sale.find({
      customer: customer._id,
      status: 'completed',
      outstandingCents: { $gt: 0 },
    })
      .sort({ createdAt: 1 })
      .session(session);

    const totalOutstandingCents = outstandingInvoices.reduce((sum, s) => sum + s.outstandingCents, 0);
    if (totalOutstandingCents <= 0) {
      throw new ApiError(409, 'This customer has no outstanding debt to pay.');
    }
    if (amountCents > totalOutstandingCents) {
      throw new ApiError(
        400,
        `Payment ($${amount.toFixed(2)}) exceeds the customer's total outstanding debt ($${fromCents(totalOutstandingCents).toFixed(2)}).`
      );
    }

    const allocations = [];
    let remaining = amountCents;

    if (requestedAllocations) {
      // Manual allocation: pay specific invoices by id.
      const bySaleId = new Map(outstandingInvoices.map((s) => [s._id.toString(), s]));
      for (const a of requestedAllocations) {
        const sale = bySaleId.get(String(a.saleId));
        if (!sale) throw new ApiError(400, 'One of the selected invoices is no longer outstanding.');
        const allocCents = toCents(a.amount);
        if (allocCents <= 0) continue;
        if (allocCents > sale.outstandingCents) {
          throw new ApiError(400, `Allocation to ${sale.receiptNumber} exceeds its outstanding balance.`);
        }
        sale.outstandingCents -= allocCents;
        await sale.save({ session });
        allocations.push({ sale: sale._id, receiptNumber: sale.receiptNumber, amountCents: allocCents });
        remaining -= allocCents;
      }
      if (remaining !== 0) {
        throw new ApiError(400, 'Allocated amounts must add up exactly to the payment amount.');
      }
    } else {
      // Automatic allocation: oldest invoice first.
      for (const sale of outstandingInvoices) {
        if (remaining <= 0) break;
        const take = Math.min(sale.outstandingCents, remaining);
        sale.outstandingCents -= take;
        await sale.save({ session });
        allocations.push({ sale: sale._id, receiptNumber: sale.receiptNumber, amountCents: take });
        remaining -= take;
      }
    }

    const previousBalanceCents = customer.balanceCents;
    customer.balanceCents -= amountCents;
    customer.totalPaidCents += amountCents;
    await customer.save({ session });

    const receiptNumber = await generatePaymentReceiptNumber(session);

    const [payment] = await Payment.create(
      [
        {
          receiptNumber,
          customer: customer._id,
          amountCents,
          type: 'debt_payment',
          allocations,
          previousBalanceCents,
          newBalanceCents: customer.balanceCents,
          notes: req.body.notes || '',
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    await CustomerLedger.create(
      [
        {
          customer: customer._id,
          type: 'PAYMENT',
          amountCents: -amountCents,
          payment: payment._id,
          description: `Debt payment ${receiptNumber} (${allocations.map((a) => a.receiptNumber).join(', ')})`,
          balanceBeforeCents: previousBalanceCents,
          balanceAfterCents: customer.balanceCents,
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    return { payment, customer };
  });

  await logAudit({
    user: req.user,
    action: 'customer.payment',
    entityType: 'Customer',
    entityId: result.customer._id,
    details: { amount, receiptNumber: result.payment.receiptNumber },
  });

  res.status(201).json({
    success: true,
    data: { customer: toDTO(result.customer), paymentId: result.payment._id, receiptNumber: result.payment.receiptNumber },
  });
});

export { toDTO as customerToDTO };

import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import InventoryItem from '../models/InventoryItem.js';
import Account from '../models/Account.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { toCents } from '../utils/money.js';
import { reserveStock } from './stockService.js';
import { createPendingTransaction } from './accountService.js';

async function generateReceiptNumber(session) {
  const seq = await nextSequence('sale', session);
  const year = new Date().getFullYear();
  return `INV-${year}-${String(seq).padStart(6, '0')}`;
}

export function validateSaleItems({ items, discount, paidAmount }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'Add at least one product to the sale.');
  }
  for (const line of items) {
    if (!line.itemId) throw new ApiError(400, 'Each sale line must reference a product.');
    if (!Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) <= 0) {
      throw new ApiError(400, 'Quantity must be greater than zero for every product.');
    }
  }
  if (!Number.isFinite(Number(discount)) || !Number.isSafeInteger(toCents(discount)) || Number(discount) < 0) throw new ApiError(400, 'Discount cannot be negative.');
  if (!Number.isFinite(Number(paidAmount)) || !Number.isSafeInteger(toCents(paidAmount)) || Number(paidAmount) < 0) throw new ApiError(400, 'Paid amount cannot be negative.');
}


// Authoritative draft creation, shared by POS and quotation conversion.
export async function createSaleDraft(payload, user, session, { quotedPrices, quotationId } = {}) {
  const { customerId, items, discount = 0, paidAmount = 0, paymentAccountId } = payload;
  if (!customerId) throw new ApiError(400, 'Please select or create a customer before completing the sale.');
  validateSaleItems({ items, discount, paidAmount });


    const customer = await Customer.findById(customerId).session(session);
    if (!customer) throw new ApiError(404, 'Customer not found. Please select a valid customer.');

    let account = null;
    if (paymentAccountId) {
      account = await Account.findById(paymentAccountId).session(session);
      if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');
    }
    // Validate the receiving account before reserving stock.
    if (toCents(paidAmount) > 0 && !account) {
      throw new ApiError(400, 'Please select a payment account for the amount being paid.');
    }

    const saleItems = [];
    let subtotalCents = 0;

    for (const line of items) {
      const item = await InventoryItem.findById(line.itemId).session(session);
      if (!item) throw new ApiError(404, `Product not found (id: ${line.itemId}).`);
      if (item.status !== 'active') throw new ApiError(409, `Product ${item.name} is not active.`);

      const qty = Math.round(Number(line.quantity));
      const batchReservations = await reserveStock(item._id, qty, session);

      const unitPriceCents = quotedPrices ? quotedPrices.get(String(item._id)) : item.sellingPriceCents;
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new ApiError(400, 'Invalid quoted price.');
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
          quotation: quotationId || undefined,
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
          createdBy: user?._id,
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
          createdBy: user,
        },
        session
      );
      sale.accountTransaction = txn?._id || null;
      await sale.save({ session });
    }

    return sale;
}

import mongoose from 'mongoose';

const allocationSchema = new mongoose.Schema(
  {
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
    receiptNumber: { type: String, required: true },
    amountCents: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    receiptNumber: { type: String, required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    amountCents: { type: Number, required: true },
    type: { type: String, enum: ['sale', 'debt_payment', 'refund'], default: 'debt_payment' },
    relatedSale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null }, // used for type: 'sale' (payment collected at sale time)
    allocations: { type: [allocationSchema], default: [] }, // used for type: 'debt_payment' — which invoices this payment settled
    previousBalanceCents: { type: Number, default: 0 },
    newBalanceCents: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

paymentSchema.index({ customer: 1, createdAt: -1 });
paymentSchema.index({ receiptNumber: 1 });

export default mongoose.model('Payment', paymentSchema);

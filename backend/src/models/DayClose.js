import mongoose from 'mongoose';

const paymentBreakdownSchema = new mongoose.Schema(
  { account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' }, accountName: String, amountCents: Number },
  { _id: false }
);

// One record per confirmed calendar business day. Re-running Close Day on
// the same date (e.g. drafts created after an earlier close) accumulates
// into the same document instead of creating a duplicate.
const dayCloseSchema = new mongoose.Schema(
  {
    businessDate: { type: Date, required: true, unique: true }, // normalized to local midnight
    invoiceCount: { type: Number, default: 0 },
    revenueCents: { type: Number, default: 0 },
    cogsCents: { type: Number, default: 0 },
    grossProfitCents: { type: Number, default: 0 },
    cashCollectedCents: { type: Number, default: 0 },
    customerCreditCents: { type: Number, default: 0 },
    paymentBreakdown: { type: [paymentBreakdownSchema], default: [] },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedByName: { type: String, default: '' },
    closedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model('DayClose', dayCloseSchema);

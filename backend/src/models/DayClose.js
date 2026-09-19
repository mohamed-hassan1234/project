import mongoose from 'mongoose';

const paymentBreakdownSchema = new mongoose.Schema(
  { account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' }, accountName: String, amountCents: Number },
  { _id: false }
);

const cashierAccountSchema = new mongoose.Schema(
  { account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' }, accountName: String, amountCents: Number },
  { _id: false }
);

const cashierBreakdownSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    byAccount: { type: [cashierAccountSchema], default: [] },
    totalCents: { type: Number, default: 0 },
  },
  { _id: false }
);

const accountResetSchema = new mongoose.Schema(
  { account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' }, accountName: String, balanceBeforeResetCents: Number },
  { _id: false }
);

// One immutable record per actual Close Day *event* -- not merged across
// repeated closes on the same calendar date the way it used to be. With the
// BusinessDay OPEN/CLOSED gate, a second close on the same date can only
// happen after an explicit Open Day in between, and each is its own
// complete, standalone snapshot (own cashier/account breakdowns, own
// pre-reset balances) rather than an accumulating total.
const dayCloseSchema = new mongoose.Schema(
  {
    businessDate: { type: Date, required: true }, // normalized to local midnight -- indexed, no longer unique (see above)
    invoiceCount: { type: Number, default: 0 },
    revenueCents: { type: Number, default: 0 },
    cogsCents: { type: Number, default: 0 },
    grossProfitCents: { type: Number, default: 0 },
    cashCollectedCents: { type: Number, default: 0 },
    customerCreditCents: { type: Number, default: 0 },
    paymentBreakdown: { type: [paymentBreakdownSchema], default: [] },
    cashierBreakdown: { type: [cashierBreakdownSchema], default: [] },
    // The pre-reset balance of every account zeroed by this close, so a
    // historical report can always show what each account actually held
    // that day even though its live balance has since been reset to 0 and
    // moved on. See dayCloseService.resetOperationalAccounts.
    accountBalancesBeforeReset: { type: [accountResetSchema], default: [] },
    invoiceReferences: { type: [String], default: [] }, // receiptNumbers confirmed by this close
    openedAt: { type: Date, default: null }, // when this business-day session began (Open Day / previous close)
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedByName: { type: String, default: '' },
    closedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

dayCloseSchema.index({ businessDate: -1 });

export default mongoose.model('DayClose', dayCloseSchema);

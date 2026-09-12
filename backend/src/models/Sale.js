import mongoose from 'mongoose';

// Which lots (and therefore which purchases/suppliers) a sold quantity was
// drawn from, in FIFO order. Lets supplier/item profitability reports trace
// realized revenue and COGS back to the exact purchase batch.
const lotConsumptionSchema = new mongoose.Schema(
  {
    lot: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLot', required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    purchase: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
    quantity: { type: Number, required: true, min: 1 },
    unitCostCents: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const saleItemSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, required: true },
    itemCode: { type: String, default: '' },
    serialNumber: { type: String, default: '' },
    sku: { type: String, default: '' }, // legacy, kept for historical records
    quantity: { type: Number, required: true, min: 1 },
    unitPriceCents: { type: Number, required: true, min: 0 }, // selling price at time of sale
    costPriceCents: { type: Number, required: true, min: 0 }, // weighted-avg FIFO cost at time of sale (historical)
    subtotalCents: { type: Number, required: true, min: 0 },
    lotConsumption: { type: [lotConsumptionSchema], default: [] },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    receiptNumber: { type: String, required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    items: { type: [saleItemSchema], required: true, validate: (v) => v.length > 0 },
    subtotalCents: { type: Number, required: true, default: 0 },
    discountCents: { type: Number, required: true, default: 0 },
    totalCents: { type: Number, required: true, default: 0 },
    paidAmountCents: { type: Number, required: true, default: 0 }, // paid at the moment of sale
    balanceAddedCents: { type: Number, required: true, default: 0 }, // credit created by this sale (totalCents - paidAmountCents)
    outstandingCents: { type: Number, required: true, default: 0 }, // remaining unpaid on THIS invoice (decreases as debt payments are allocated to it)
    costOfGoodsCents: { type: Number, required: true, default: 0 },
    profitCents: { type: Number, required: true, default: 0 },
    previousBalanceCents: { type: Number, required: true, default: 0 }, // customer's outstanding debt immediately before this sale
    status: { type: String, enum: ['completed', 'voided'], default: 'completed' },
    voidedAt: { type: Date, default: null },
    voidedReason: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

saleSchema.index({ customer: 1, createdAt: -1 });
saleSchema.index({ createdAt: -1 });
saleSchema.index({ receiptNumber: 1 });
saleSchema.index({ customer: 1, outstandingCents: 1 });

export default mongoose.model('Sale', saleSchema);

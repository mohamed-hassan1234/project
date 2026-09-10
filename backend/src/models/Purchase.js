import mongoose from 'mongoose';

const purchaseItemSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitCostCents: { type: Number, required: true, min: 0 },
    subtotalCents: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const purchaseSchema = new mongoose.Schema(
  {
    purchaseNumber: { type: String, required: true, unique: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    items: { type: [purchaseItemSchema], required: true, validate: (v) => v.length > 0 },
    totalCostCents: { type: Number, required: true, default: 0 },
    paidAmountCents: { type: Number, required: true, default: 0 },
    balanceCents: { type: Number, required: true, default: 0 }, // owed to supplier
    purchaseDate: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['completed', 'voided'], default: 'completed' },
    voidedAt: { type: Date, default: null },
    voidedReason: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

purchaseSchema.index({ supplier: 1, createdAt: -1 });
purchaseSchema.index({ createdAt: -1 });

export default mongoose.model('Purchase', purchaseSchema);

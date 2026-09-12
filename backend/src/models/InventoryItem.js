import mongoose from 'mongoose';

const DEFAULT_LOW_STOCK_THRESHOLD = 5;

const inventoryItemSchema = new mongoose.Schema(
  {
    itemCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    serialNumber: { type: String, trim: true, default: '' },
    // Legacy fields kept so historical records are never lost. No longer
    // collected from the UI (see itemCode/serialNumber above).
    sku: { type: String, trim: true, default: '' },
    barcode: { type: String, trim: true, default: '' },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    description: { type: String, default: '' },
    quantity: { type: Number, required: true, default: 0, min: 0 },
    unit: { type: String, default: 'pcs' },
    costPriceCents: { type: Number, required: true, default: 0, min: 0 },
    sellingPriceCents: { type: Number, required: true, default: 0, min: 0 },
    // No longer set per-item from the UI; centrally defaulted so low-stock
    // detection keeps working without requiring manual entry at creation time.
    lowStockThreshold: { type: Number, default: DEFAULT_LOW_STOCK_THRESHOLD, min: 0 },
    expiryDate: { type: Date, default: null },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  // autoIndex is disabled here on purpose: the itemCode/serialNumber unique
  // indexes must only be built AFTER migrateInventorySchema() has backfilled
  // every legacy document, otherwise multiple docs sharing an absent
  // itemCode would collide on the unique index build. server.js calls
  // InventoryItem.syncIndexes() itself once migration has run.
  { timestamps: true, autoIndex: false }
);

inventoryItemSchema.index({ name: 'text', itemCode: 'text', serialNumber: 'text', sku: 'text', barcode: 'text' });
inventoryItemSchema.index({ itemCode: 1 }, { unique: true });
// $ne isn't supported in a partial index filter; $gt: '' is an equivalent
// "non-empty string" test since all non-empty strings sort after ''.
inventoryItemSchema.index({ serialNumber: 1 }, { unique: true, partialFilterExpression: { serialNumber: { $type: 'string', $gt: '' } } });
inventoryItemSchema.index({ category: 1 });
inventoryItemSchema.index({ expiryDate: 1 });

inventoryItemSchema.virtual('stockStatus').get(function computeStockStatus() {
  if (this.quantity <= 0) return 'out_of_stock';
  if (this.quantity <= this.lowStockThreshold) return 'low_stock';
  return 'in_stock';
});

inventoryItemSchema.virtual('expiryStatus').get(function computeExpiryStatus() {
  if (!this.expiryDate) return 'none';
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysLeft = Math.ceil((this.expiryDate.getTime() - now.getTime()) / msPerDay);
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'near_expiry';
  return 'ok';
});

inventoryItemSchema.set('toJSON', { virtuals: true });
inventoryItemSchema.set('toObject', { virtuals: true });

export { DEFAULT_LOW_STOCK_THRESHOLD };
export default mongoose.model('InventoryItem', inventoryItemSchema);

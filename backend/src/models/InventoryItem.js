import mongoose from 'mongoose';

const inventoryItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true, default: '' },
    barcode: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: 'Uncategorized' },
    description: { type: String, default: '' },
    quantity: { type: Number, required: true, default: 0, min: 0 },
    unit: { type: String, default: 'pcs' },
    costPriceCents: { type: Number, required: true, default: 0, min: 0 },
    sellingPriceCents: { type: Number, required: true, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    expiryDate: { type: Date, default: null },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

inventoryItemSchema.index({ name: 'text', sku: 'text', barcode: 'text' });
inventoryItemSchema.index({ sku: 1 });
inventoryItemSchema.index({ barcode: 1 });
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

export default mongoose.model('InventoryItem', inventoryItemSchema);

import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  stockSerial: { type: String, required: true, unique: true },
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  purchaseInvoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
  rows: [{ item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true }, itemName: String, batch: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLot', required: true }, quantity: Number, costPriceCents: Number, sellingPriceCents: Number, expiryDate: Date }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
export default mongoose.model('StockEntry', schema);

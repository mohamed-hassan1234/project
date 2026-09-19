import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { runInTransaction } from '../utils/transaction.js';
import { nextSequence } from '../models/Counter.js';
import { toCents } from '../utils/money.js';
import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import StockEntry from '../models/StockEntry.js';
import Supplier from '../models/Supplier.js';
import { ensureLegacyLots } from '../services/batchService.js';
import { calculateWeightedAverageCost } from '../services/costingService.js';
const router = Router();
router.use(requireAuth);
router.use(requirePermission('stock'));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
router.post('/', asyncHandler(async (req, res) => {
  const { rows, externalSerialNumber = '', supplierId = null } = req.body;
  if (typeof externalSerialNumber !== 'string' || externalSerialNumber.length > 100) throw new ApiError(400, 'Shop/supplier serial number must be text of at most 100 characters.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) throw new ApiError(400, 'Enter between 1 and 200 stock rows.');
  for (const [i, row] of rows.entries()) {
    if (!row.itemId && !String(row.name || '').trim()) throw new ApiError(400, `Row ${i + 1}: select or name an item.`);
    if (!Number.isSafeInteger(Number(row.quantity)) || Number(row.quantity) <= 0) throw new ApiError(400, `Row ${i + 1}: quantity must be a positive whole number.`);
    for (const key of ['costPrice', 'sellingPrice']) if (row[key] === '' || row[key] == null || !Number.isFinite(Number(row[key])) || Number(row[key]) < 0) throw new ApiError(400, `Row ${i + 1}: enter a valid ${key}.`);
    if (row.expiryDate && (!/^\d{4}-\d{2}-\d{2}$/.test(row.expiryDate) || !Number.isFinite(Date.parse(row.expiryDate)) || new Date(row.expiryDate).toISOString().slice(0, 10) !== row.expiryDate)) throw new ApiError(400, `Row ${i + 1}: expiry is invalid.`);
  }
  const entry = await runInTransaction(async session => {
    let supplier = null;
    if (supplierId) {
      supplier = await Supplier.findById(supplierId).session(session);
      if (!supplier) throw new ApiError(404, 'Selected supplier no longer exists.');
    }
    // This shared counter also serializes concurrent inline item creation.
    const seq = await nextSequence('stockEntry', session);
    const stockSerial = `STK-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
    const entry = new StockEntry({ stockSerial, externalSerialNumber: externalSerialNumber.trim(), supplier: supplier?._id || null, createdBy: req.user._id, rows: [] });
    for (const row of rows) {
      const name = String(row.name || '').trim().replace(/\s+/g, ' ');
      let item = row.itemId ? await InventoryItem.findById(row.itemId).session(session) : await InventoryItem.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } }).session(session);
      if (!item && row.itemId) throw new ApiError(404, 'Selected item no longer exists.');
      if (!item) {
        const code = await nextSequence('itemCode', session);
        item = new InventoryItem({ name, itemCode: `ITM-${String(code).padStart(6, '0')}`, quantity: 0 });
      } else await ensureLegacyLots(item, session);
      const quantity = Number(row.quantity), costPriceCents = toCents(row.costPrice), sellingPriceCents = toCents(row.sellingPrice);
      const expiryDate = row.expiryDate ? new Date(`${row.expiryDate}T23:59:59.999Z`) : null;
      const [batch] = await InventoryLot.create([{ item: item._id, stockEntry: entry._id, stockSerial, supplier: supplier?._id || item.supplier || null, unitCostCents: costPriceCents, sellingPriceCents, expiryDate, originalQuantity: quantity, remainingQuantity: quantity }], { session });
      // WAC recalculated here, inside this transaction, from the item's
      // CURRENT quantity/average -- never from a value read earlier or
      // computed on the frontend. If another request receives stock for the
      // same item concurrently, runInTransaction's session.withTransaction
      // retries this whole callback on write conflict, so this always blends
      // against the latest committed state (no lost update).
      const oldQuantity = item.quantity;
      const oldAverageCostCents = item.costPriceCents;
      const newAverageCostCents = calculateWeightedAverageCost({
        oldQuantity,
        oldAverageCostCents,
        incomingQuantity: quantity,
        incomingUnitCostCents: costPriceCents,
      });
      item.stockEvents.push({
        type: item.quantity === 0 ? 'RESTOCK' : 'RECEIPT',
        reference: stockSerial,
        quantityBefore: item.quantity,
        quantityAfter: item.quantity + quantity,
        averageCostBeforeCents: oldAverageCostCents,
        averageCostAfterCents: newAverageCostCents,
      });
      item.quantity += quantity;
      item.sellingPriceCents = sellingPriceCents;
      item.costPriceCents = newAverageCostCents;
      if (supplier && !item.supplier) item.supplier = supplier._id;
      await item.save({ session });
      entry.rows.push({ item: item._id, itemName: item.name, batch: batch._id, quantity, costPriceCents, sellingPriceCents, expiryDate });
    }
    await entry.save({ session });
    return entry;
  });
  res.status(201).json({ success: true, data: entry });
}));
router.get('/', asyncHandler(async (req, res) => {
  const q = escapeRegex(String(req.query.q || '').trim());
  const filter = q ? { $or: [{ stockSerial: { $regex: q, $options: 'i' } }, { externalSerialNumber: { $regex: q, $options: 'i' } }, { 'rows.itemName': { $regex: q, $options: 'i' } }] } : {};
  if (req.query.supplier) filter.supplier = req.query.supplier;
  const page = Math.max(1, Number(req.query.page) || 1);
  const data = await StockEntry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).populate('rows.batch').populate('supplier', 'name phone email address');
  res.json({ success: true, data, total: await StockEntry.countDocuments(filter) });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const data = await StockEntry.findById(req.params.id).populate('rows.batch').populate('createdBy', 'name').populate('supplier', 'name phone email address');
  if (!data) throw new ApiError(404, 'Stock entry not found.');
  res.json({ success: true, data });
}));
export default router;

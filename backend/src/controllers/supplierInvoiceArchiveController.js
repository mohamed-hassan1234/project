import SupplierInvoiceArchive from '../models/SupplierInvoiceArchive.js';
import Supplier from '../models/Supplier.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toDTO(doc) {
  return {
    id: doc._id,
    archiveNumber: doc.archiveNumber,
    serialNumber: doc.serialNumber,
    supplier: doc.supplier?._id || doc.supplier,
    supplierName: doc.supplierName,
    rows: doc.rows.map((r) => ({
      itemName: r.itemName,
      quantity: r.quantity,
      cost: fromCents(r.costCents),
      total: fromCents(r.totalCents),
    })),
    grandTotal: fromCents(doc.grandTotalCents),
    notes: doc.notes,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
  };
}

async function generateArchiveNumber() {
  const seq = await nextSequence('supplierInvoiceArchive');
  const year = new Date().getFullYear();
  return `SINV-${year}-${String(seq).padStart(6, '0')}`;
}

// POST /api/supplier-invoice-archives -- saves the supplier's paper invoice
// exactly as entered, as ONE archive record. This is intentionally the
// entire operation: no Stock, no InventoryItem, no Account is ever touched
// here. It is a pure reference/archive document.
export const createArchive = asyncHandler(async (req, res) => {
  const { serialNumber, supplierId, rows, notes = '' } = req.body;
  if (typeof serialNumber !== 'string' || !serialNumber.trim()) throw new ApiError(400, 'Shop/Supplier serial number is required.');
  if (serialNumber.length > 100) throw new ApiError(400, 'Serial number is too long.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new ApiError(400, 'Enter between 1 and 500 rows.');

  let supplier = null;
  if (supplierId) {
    supplier = await Supplier.findById(supplierId);
    if (!supplier) throw new ApiError(404, 'Selected supplier no longer exists.');
  }

  let grandTotalCents = 0;
  const builtRows = rows.map((row, i) => {
    const itemName = String(row.itemName || '').trim();
    if (!itemName) throw new ApiError(400, `Row ${i + 1}: item name is required.`);
    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ApiError(400, `Row ${i + 1}: quantity must be a positive number.`);
    if (row.cost === '' || row.cost == null || !Number.isFinite(Number(row.cost)) || Number(row.cost) < 0) {
      throw new ApiError(400, `Row ${i + 1}: enter a valid cost.`);
    }
    const costCents = toCents(row.cost);
    const totalCents = Math.round(quantity * costCents);
    grandTotalCents += totalCents;
    return { itemName, quantity, costCents, totalCents };
  });

  const archiveNumber = await generateArchiveNumber();
  const archive = await SupplierInvoiceArchive.create({
    archiveNumber,
    serialNumber: serialNumber.trim(),
    supplier: supplier?._id || null,
    supplierName: supplier?.name || '',
    rows: builtRows,
    grandTotalCents,
    notes: notes || '',
    createdBy: req.user?._id,
  });

  res.status(201).json({ success: true, data: toDTO(archive) });
});

// GET /api/supplier-invoice-archives?serial=... -- primary lookup, by the
// supplier/shop's own serial number (never today's Inventory prices).
export const searchArchives = asyncHandler(async (req, res) => {
  const filter = {};
  const serial = String(req.query.serial || '').trim();
  if (serial) filter.serialNumber = { $regex: escapeRegex(serial), $options: 'i' };
  if (req.query.supplier) filter.supplier = req.query.supplier;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const [rows, total] = await Promise.all([
    SupplierInvoiceArchive.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    SupplierInvoiceArchive.countDocuments(filter),
  ]);
  res.json({ success: true, data: rows.map(toDTO), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const getArchive = asyncHandler(async (req, res) => {
  const archive = await SupplierInvoiceArchive.findById(req.params.id);
  if (!archive) throw new ApiError(404, 'Supplier invoice archive not found.');
  res.json({ success: true, data: toDTO(archive) });
});

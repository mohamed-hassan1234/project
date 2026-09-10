import InventoryItem from '../models/InventoryItem.js';
import Sale from '../models/Sale.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { logAudit } from '../services/auditService.js';

function toDTO(item) {
  const obj = item.toObject ? item.toObject({ virtuals: true }) : item;
  return {
    id: obj._id,
    name: obj.name,
    sku: obj.sku,
    barcode: obj.barcode,
    category: obj.category,
    description: obj.description,
    quantity: obj.quantity,
    unit: obj.unit,
    costPrice: fromCents(obj.costPriceCents),
    sellingPrice: fromCents(obj.sellingPriceCents),
    lowStockThreshold: obj.lowStockThreshold,
    expiryDate: obj.expiryDate,
    supplier: obj.supplier,
    status: obj.status,
    stockStatus: obj.stockStatus,
    expiryStatus: obj.expiryStatus,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const NEAR_EXPIRY_DAYS = 30;

function buildFilter(query) {
  const { search, category, supplier, stockFilter, expiryFilter } = query;
  const filter = {};

  if (search && search.trim()) {
    filter.$or = [
      { name: { $regex: search.trim(), $options: 'i' } },
      { sku: { $regex: search.trim(), $options: 'i' } },
      { barcode: { $regex: search.trim(), $options: 'i' } },
    ];
  }
  if (category) filter.category = category;
  if (supplier) filter.supplier = supplier;

  if (stockFilter === 'low_stock') {
    filter.$expr = { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }] };
  } else if (stockFilter === 'out_of_stock') {
    filter.quantity = { $lte: 0 };
  } else if (stockFilter === 'in_stock') {
    filter.$expr = { $gt: ['$quantity', '$lowStockThreshold'] };
  }

  if (expiryFilter === 'expired') {
    filter.expiryDate = { $ne: null, $lt: new Date() };
  } else if (expiryFilter === 'near_expiry') {
    const cutoff = new Date(Date.now() + NEAR_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    filter.expiryDate = { $ne: null, $gte: new Date(), $lte: cutoff };
  }

  return filter;
}

// GET /api/inventory
export const listInventory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sortBy = 'createdAt', sortDir = 'desc' } = req.query;
  const filter = buildFilter(req.query);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
  const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };

  const [items, total] = await Promise.all([
    InventoryItem.find(filter)
      .populate('supplier', 'name')
      .sort(sort)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    InventoryItem.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map(toDTO),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

// GET /api/inventory/search?q= -- used by POS product picker
export const searchInventory = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, data: [] });

  const items = await InventoryItem.find({
    status: 'active',
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { sku: { $regex: q, $options: 'i' } },
      { barcode: { $regex: q, $options: 'i' } },
    ],
  })
    .limit(15)
    .sort({ name: 1 });

  res.json({ success: true, data: items.map(toDTO) });
});

export const getInventoryItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id).populate('supplier', 'name phone');
  if (!item) throw new ApiError(404, 'Item not found.');
  res.json({ success: true, data: toDTO(item) });
});

export const createInventoryItem = asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body.name || !body.name.trim()) throw new ApiError(400, 'Item name is required.');
  if (body.costPrice === undefined || body.sellingPrice === undefined) {
    throw new ApiError(400, 'Cost price and selling price are required.');
  }
  if (Number(body.costPrice) < 0 || Number(body.sellingPrice) < 0) {
    throw new ApiError(400, 'Prices cannot be negative.');
  }
  if (body.quantity !== undefined && Number(body.quantity) < 0) {
    throw new ApiError(400, 'Quantity cannot be negative.');
  }

  const item = await InventoryItem.create({
    name: body.name.trim(),
    sku: body.sku?.trim() || '',
    barcode: body.barcode?.trim() || '',
    category: body.category?.trim() || 'Uncategorized',
    description: body.description || '',
    quantity: Number(body.quantity) || 0,
    unit: body.unit || 'pcs',
    costPriceCents: toCents(body.costPrice),
    sellingPriceCents: toCents(body.sellingPrice),
    lowStockThreshold: body.lowStockThreshold !== undefined ? Number(body.lowStockThreshold) : 5,
    expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
    supplier: body.supplier || null,
    status: body.status || 'active',
  });

  await logAudit({
    user: req.user,
    action: 'inventory.create',
    entityType: 'InventoryItem',
    entityId: item._id,
    details: { name: item.name },
  });

  res.status(201).json({ success: true, data: toDTO(item) });
});

export const updateInventoryItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Item not found.');

  const body = req.body;
  if (body.name !== undefined) {
    if (!body.name.trim()) throw new ApiError(400, 'Item name cannot be empty.');
    item.name = body.name.trim();
  }
  if (body.sku !== undefined) item.sku = body.sku.trim();
  if (body.barcode !== undefined) item.barcode = body.barcode.trim();
  if (body.category !== undefined) item.category = body.category.trim() || 'Uncategorized';
  if (body.description !== undefined) item.description = body.description;
  if (body.quantity !== undefined) {
    if (Number(body.quantity) < 0) throw new ApiError(400, 'Quantity cannot be negative.');
    item.quantity = Number(body.quantity);
  }
  if (body.unit !== undefined) item.unit = body.unit;
  if (body.costPrice !== undefined) {
    if (Number(body.costPrice) < 0) throw new ApiError(400, 'Cost price cannot be negative.');
    item.costPriceCents = toCents(body.costPrice);
  }
  if (body.sellingPrice !== undefined) {
    if (Number(body.sellingPrice) < 0) throw new ApiError(400, 'Selling price cannot be negative.');
    item.sellingPriceCents = toCents(body.sellingPrice);
  }
  if (body.lowStockThreshold !== undefined) item.lowStockThreshold = Number(body.lowStockThreshold);
  if (body.expiryDate !== undefined) item.expiryDate = body.expiryDate ? new Date(body.expiryDate) : null;
  if (body.supplier !== undefined) item.supplier = body.supplier || null;
  if (body.status !== undefined) item.status = body.status;

  await item.save();

  await logAudit({
    user: req.user,
    action: 'inventory.update',
    entityType: 'InventoryItem',
    entityId: item._id,
    details: req.body,
  });

  res.json({ success: true, data: toDTO(item) });
});

export const deleteInventoryItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Item not found.');

  const saleCount = await Sale.countDocuments({ 'items.item': item._id, status: 'completed' });
  if (saleCount > 0) {
    throw new ApiError(
      409,
      'This item has sales history and cannot be deleted. Consider marking it inactive instead.'
    );
  }

  await item.deleteOne();

  await logAudit({
    user: req.user,
    action: 'inventory.delete',
    entityType: 'InventoryItem',
    entityId: item._id,
    details: { name: item.name },
  });

  res.json({ success: true, data: { id: req.params.id } });
});

// GET /api/inventory/alerts/summary -- used by dashboard
export const getAlertsSummary = asyncHandler(async (req, res) => {
  const cutoff = new Date(Date.now() + NEAR_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const [lowStock, outOfStock, expired, nearExpiry] = await Promise.all([
    InventoryItem.find({ $expr: { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }] } })
      .limit(50)
      .sort({ quantity: 1 }),
    InventoryItem.countDocuments({ quantity: { $lte: 0 } }),
    InventoryItem.find({ expiryDate: { $ne: null, $lt: new Date() } }).limit(50),
    InventoryItem.find({ expiryDate: { $ne: null, $gte: new Date(), $lte: cutoff } }).limit(50),
  ]);

  res.json({
    success: true,
    data: {
      lowStock: lowStock.map(toDTO),
      outOfStockCount: outOfStock,
      expired: expired.map(toDTO),
      nearExpiry: nearExpiry.map(toDTO),
    },
  });
});

export { toDTO as inventoryToDTO };

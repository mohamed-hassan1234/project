import InventoryItem from '../models/InventoryItem.js';
import Category from '../models/Category.js';
import Sale from '../models/Sale.js';
import Purchase from '../models/Purchase.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { logAudit } from '../services/auditService.js';

function toDTO(item) {
  const obj = item.toObject ? item.toObject({ virtuals: true }) : item;
  const category =
    obj.category && typeof obj.category === 'object' && obj.category.name
      ? { id: obj.category._id, name: obj.category.name }
      : obj.category
      ? { id: obj.category, name: null }
      : null;

  return {
    id: obj._id,
    itemCode: obj.itemCode,
    name: obj.name,
    serialNumber: obj.serialNumber || '',
    category,
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

async function generateItemCode() {
  const seq = await nextSequence('itemCode');
  return `ITM-${String(seq).padStart(6, '0')}`;
}

function buildFilter(query) {
  const { search, category, supplier, stockFilter, expiryFilter } = query;
  const filter = {};

  if (search && search.trim()) {
    filter.$or = [
      { name: { $regex: search.trim(), $options: 'i' } },
      { itemCode: { $regex: search.trim(), $options: 'i' } },
      { serialNumber: { $regex: search.trim(), $options: 'i' } },
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
      .populate('category', 'name')
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

// GET /api/inventory/search?q= -- used by the Seller/POS row item picker and
// by inventory serial-number search
export const searchInventory = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, data: [] });

  const items = await InventoryItem.find({
    status: 'active',
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { itemCode: { $regex: q, $options: 'i' } },
      { serialNumber: { $regex: q, $options: 'i' } },
    ],
  })
    .populate('category', 'name')
    .limit(15)
    .sort({ name: 1 });

  res.json({ success: true, data: items.map(toDTO) });
});

export const getInventoryItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id).populate('supplier', 'name phone').populate('category', 'name');
  if (!item) throw new ApiError(404, 'Item not found.');

  const purchaseLines = await Purchase.aggregate([
    { $match: { status: 'completed', 'items.item': item._id } },
    { $unwind: '$items' },
    { $match: { 'items.item': item._id } },
    {
      $project: {
        purchaseNumber: 1,
        supplierName: 1,
        purchaseDate: 1,
        createdAt: 1,
        quantity: '$items.quantity',
        unitCostCents: '$items.unitCostCents',
        subtotalCents: '$items.subtotalCents',
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 25 },
  ]);

  res.json({
    success: true,
    data: {
      ...toDTO(item),
      purchaseHistory: purchaseLines.map((p) => ({
        purchaseNumber: p.purchaseNumber,
        supplierName: p.supplierName,
        quantity: p.quantity,
        unitCost: fromCents(p.unitCostCents),
        total: fromCents(p.subtotalCents),
        date: p.purchaseDate || p.createdAt,
      })),
    },
  });
});

async function assertCategoryExists(categoryId) {
  if (!categoryId) return null;
  const category = await Category.findById(categoryId);
  if (!category) throw new ApiError(400, 'Selected category does not exist.');
  return category._id;
}

async function assertSerialNumberAvailable(serialNumber, excludeId) {
  if (!serialNumber) return;
  const filter = { serialNumber };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await InventoryItem.findOne(filter);
  if (existing) throw new ApiError(409, `Serial number "${serialNumber}" is already assigned to another item.`);
}

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

  const serialNumber = body.serialNumber?.trim() || '';
  await assertSerialNumberAvailable(serialNumber);
  const categoryId = await assertCategoryExists(body.category || null);
  const itemCode = await generateItemCode();

  const item = await InventoryItem.create({
    itemCode,
    name: body.name.trim(),
    serialNumber,
    category: categoryId,
    quantity: Number(body.quantity) || 0,
    unit: body.unit || 'pcs',
    costPriceCents: toCents(body.costPrice),
    sellingPriceCents: toCents(body.sellingPrice),
    expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
    supplier: body.supplier || null,
    status: body.status || 'active',
  });

  await item.populate('category', 'name');
  await item.populate('supplier', 'name');

  await logAudit({
    user: req.user,
    action: 'inventory.create',
    entityType: 'InventoryItem',
    entityId: item._id,
    details: { name: item.name, itemCode: item.itemCode },
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
  if (body.serialNumber !== undefined) {
    const serialNumber = body.serialNumber.trim();
    await assertSerialNumberAvailable(serialNumber, item._id);
    item.serialNumber = serialNumber;
  }
  if (body.category !== undefined) {
    item.category = await assertCategoryExists(body.category || null);
  }
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
  if (body.expiryDate !== undefined) item.expiryDate = body.expiryDate ? new Date(body.expiryDate) : null;
  if (body.supplier !== undefined) item.supplier = body.supplier || null;
  if (body.status !== undefined) item.status = body.status;

  await item.save();
  await item.populate('category', 'name');
  await item.populate('supplier', 'name');

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
      .populate('category', 'name')
      .limit(50)
      .sort({ quantity: 1 }),
    InventoryItem.countDocuments({ quantity: { $lte: 0 } }),
    InventoryItem.find({ expiryDate: { $ne: null, $lt: new Date() } }).populate('category', 'name').limit(50),
    InventoryItem.find({ expiryDate: { $ne: null, $gte: new Date(), $lte: cutoff } }).populate('category', 'name').limit(50),
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

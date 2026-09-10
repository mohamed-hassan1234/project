import Category from '../models/Category.js';
import InventoryItem from '../models/InventoryItem.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const listCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({ name: 1 });
  res.json({ success: true, data: categories.map((c) => ({ id: c._id, name: c.name })) });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Category name is required.');
  const category = await Category.create({ name: name.trim() });
  res.status(201).json({ success: true, data: { id: category._id, name: category.name } });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new ApiError(404, 'Category not found.');

  const itemCount = await InventoryItem.countDocuments({ category: category.name });
  if (itemCount > 0) {
    throw new ApiError(409, 'This category is used by existing inventory items and cannot be deleted.');
  }

  await category.deleteOne();
  res.json({ success: true, data: { id: req.params.id } });
});

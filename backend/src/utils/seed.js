import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import Category from '../models/Category.js';
import Supplier from '../models/Supplier.js';
import InventoryItem from '../models/InventoryItem.js';
import { toCents } from './money.js';

async function seed() {
  await connectDB();

  const existingAdmin = await User.findOne({ username: 'admin' });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await User.create({ username: 'admin', passwordHash, name: 'Administrator', role: 'admin' });
    console.log('[seed] created admin user -> username: admin, password: admin123');
  } else {
    console.log('[seed] admin user already exists, skipping');
  }

  const categoryNames = ['Analgesics', 'Antibiotics', 'Vitamins & Supplements', 'First Aid', 'Personal Care'];
  for (const name of categoryNames) {
    await Category.findOneAndUpdate({ name }, { name }, { upsert: true });
  }

  let supplier = await Supplier.findOne({ name: 'ABC Pharma Distributors' });
  if (!supplier) {
    supplier = await Supplier.create({
      name: 'ABC Pharma Distributors',
      phone: '+252613966868',
      email: 'orders@abcpharma.example',
      address: 'Mogadishu - Somalia',
    });
    console.log('[seed] created sample supplier');
  }

  const sampleItems = [
    { name: 'Paracetamol 500mg (Strip of 10)', sku: 'PARA-500', category: 'Analgesics', unit: 'strip', quantity: 200, costPrice: 0.4, sellingPrice: 0.8, lowStockThreshold: 30 },
    { name: 'Amoxicillin 500mg (Strip of 10)', sku: 'AMOX-500', category: 'Antibiotics', unit: 'strip', quantity: 120, costPrice: 1.2, sellingPrice: 2.2, lowStockThreshold: 20 },
    { name: 'Vitamin C 1000mg (Bottle of 30)', sku: 'VITC-1000', category: 'Vitamins & Supplements', unit: 'bottle', quantity: 60, costPrice: 2.5, sellingPrice: 4.5, lowStockThreshold: 15 },
    { name: 'Ibuprofen 400mg (Strip of 10)', sku: 'IBUP-400', category: 'Analgesics', unit: 'strip', quantity: 90, costPrice: 0.6, sellingPrice: 1.1, lowStockThreshold: 20 },
    { name: 'Cough Syrup 100ml', sku: 'COUGH-100', category: 'First Aid', unit: 'bottle', quantity: 4, costPrice: 1.5, sellingPrice: 2.8, lowStockThreshold: 10 },
  ];

  for (const it of sampleItems) {
    const exists = await InventoryItem.findOne({ sku: it.sku });
    if (!exists) {
      await InventoryItem.create({
        ...it,
        costPriceCents: toCents(it.costPrice),
        sellingPriceCents: toCents(it.sellingPrice),
        supplier: supplier._id,
      });
    }
  }
  console.log('[seed] sample inventory ensured');

  console.log('[seed] done.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});

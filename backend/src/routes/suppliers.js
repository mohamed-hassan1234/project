import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listSuppliers,
  searchSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierHistory,
  getSupplierAnalysis,
} from '../controllers/supplierController.js';

const router = Router();
router.use(requireAuth);

router.get('/search', searchSuppliers);
router.get('/', listSuppliers);
router.post('/', createSupplier);
router.get('/:id', getSupplier);
router.put('/:id', updateSupplier);
router.delete('/:id', deleteSupplier);
router.get('/:id/history', getSupplierHistory);
router.get('/:id/analysis', getSupplierAnalysis);

export default router;

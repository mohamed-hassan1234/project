import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createPurchase,
  listPurchases,
  getPurchase,
  voidPurchase,
} from '../controllers/purchaseController.js';

const router = Router();
router.use(requireAuth);

router.get('/', listPurchases);
router.post('/', createPurchase);
router.get('/:id', getPurchase);
router.post('/:id/void', requireRole('admin', 'manager'), voidPurchase);

export default router;

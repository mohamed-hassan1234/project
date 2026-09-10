import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createSale, listSales, getSale, getReceipt, voidSale } from '../controllers/saleController.js';

const router = Router();
router.use(requireAuth);

router.get('/', listSales);
router.post('/', createSale);
router.get('/:id', getSale);
router.get('/:id/receipt', getReceipt);
router.post('/:id/void', requireRole('admin', 'manager'), voidSale);

export default router;

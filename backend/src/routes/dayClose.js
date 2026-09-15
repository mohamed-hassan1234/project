import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getPreview, confirmClose, listHistory } from '../controllers/dayCloseController.js';

const router = Router();
router.use(requireAuth);

router.get('/preview', getPreview);
router.get('/history', listHistory);
// Closing the business day is a critical, irreversible financial operation --
// restricted to admin/manager the same way voiding a sale/purchase already is.
router.post('/confirm', requireRole('admin', 'manager'), confirmClose);

export default router;

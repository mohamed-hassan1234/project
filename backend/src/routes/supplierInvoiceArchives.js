import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createArchive, searchArchives, getArchive } from '../controllers/supplierInvoiceArchiveController.js';

const router = Router();
router.use(requireAuth);
router.post('/', createArchive);
router.get('/', searchArchives);
router.get('/:id', getArchive);

export default router;

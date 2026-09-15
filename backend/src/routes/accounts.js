import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  getAccountTransactions,
  accountsReport,
} from '../controllers/accountController.js';

const router = Router();
router.use(requireAuth);

router.get('/report', accountsReport);
router.get('/', listAccounts);
router.post('/', requireRole('admin', 'manager'), createAccount);
router.get('/:id', getAccount);
router.put('/:id', requireRole('admin', 'manager'), updateAccount);
router.get('/:id/transactions', getAccountTransactions);

export default router;

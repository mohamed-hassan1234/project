import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listCustomers,
  searchCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerHistory,
  getCustomerDebt,
  payCustomerDebt,
  getCustomerStatement,
  depositToWallet,
  getWalletHistory,
} from '../controllers/customerController.js';

const router = Router();
router.use(requireAuth);

router.get('/search', searchCustomers);
router.get('/', listCustomers);
router.post('/', createCustomer);
router.get('/:id', getCustomer);
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);
router.get('/:id/history', getCustomerHistory);
router.get('/:id/statement', getCustomerStatement);
router.get('/:id/debt', getCustomerDebt);
router.post('/:id/payments', payCustomerDebt);
router.post('/:id/wallet/deposit', depositToWallet);
router.get('/:id/wallet/history', getWalletHistory);

export default router;

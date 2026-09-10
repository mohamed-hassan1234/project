import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listInventory,
  searchInventory,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  getAlertsSummary,
} from '../controllers/inventoryController.js';

const router = Router();
router.use(requireAuth);

router.get('/search', searchInventory);
router.get('/alerts/summary', getAlertsSummary);
router.get('/', listInventory);
router.post('/', createInventoryItem);
router.get('/:id', getInventoryItem);
router.put('/:id', updateInventoryItem);
router.delete('/:id', deleteInventoryItem);

export default router;

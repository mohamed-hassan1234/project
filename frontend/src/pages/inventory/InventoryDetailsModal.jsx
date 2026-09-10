import Modal from '../../components/ui/Modal.jsx';
import Badge, { stockStatusBadge, expiryStatusBadge } from '../../components/ui/Badge.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 py-2 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value}</span>
    </div>
  );
}

export default function InventoryDetailsModal({ open, onClose, item }) {
  if (!item) return null;
  const stock = stockStatusBadge(item.stockStatus);
  const expiry = expiryStatusBadge(item.expiryStatus);

  return (
    <Modal open={open} onClose={onClose} title={item.name} size="md">
      <div className="mb-4 flex gap-2">
        <Badge color={stock.color}>{stock.label}</Badge>
        {expiry && item.expiryDate && <Badge color={expiry.color}>{expiry.label}</Badge>}
      </div>
      <Row label="SKU" value={item.sku || '—'} />
      <Row label="Barcode" value={item.barcode || '—'} />
      <Row label="Category" value={item.category} />
      <Row label="Quantity" value={`${item.quantity} ${item.unit}`} />
      <Row label="Low Stock Threshold" value={item.lowStockThreshold} />
      <Row label="Cost Price" value={formatCurrency(item.costPrice)} />
      <Row label="Selling Price" value={formatCurrency(item.sellingPrice)} />
      <Row label="Margin" value={formatCurrency(item.sellingPrice - item.costPrice)} />
      <Row label="Supplier" value={item.supplier?.name || '—'} />
      <Row label="Expiry Date" value={item.expiryDate ? formatDate(item.expiryDate) : '—'} />
      <Row label="Created" value={formatDate(item.createdAt)} />
      <Row label="Last Updated" value={formatDate(item.updatedAt)} />
      {item.description && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{item.description}</div>
      )}
    </Modal>
  );
}

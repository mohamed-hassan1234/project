import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';

// Partial return for a CONFIRMED invoice: pick how many units of each line
// are coming back. Stock is restored into the exact lots they came from and
// the invoice's economics (and, if needed, a refund) are reconciled server
// side -- this only collects the quantities being returned.
export default function ReturnItemsModal({ open, onClose, sale, onReturned }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setQuantities({});
      setReason('');
    }
  }, [open, sale?.id]);

  if (!sale) return null;

  const lines = sale.items.map((item) => ({ ...item, returnable: item.quantity - (item.returnedQuantity || 0) }));
  const previewAmount = lines.reduce((sum, l) => sum + (Number(quantities[l.item]) || 0) * l.unitPrice, 0);
  const anySelected = Object.values(quantities).some((v) => Number(v) > 0);

  const handleSubmit = async () => {
    const items = lines
      .filter((l) => Number(quantities[l.item]) > 0)
      .map((l) => ({ itemId: l.item, quantity: Number(quantities[l.item]) }));
    if (!items.length) return toast.error('Enter at least one quantity to return.');
    for (const l of lines) {
      const qty = Number(quantities[l.item]) || 0;
      if (qty > l.returnable) return toast.error(`Cannot return ${qty} of "${l.name}": only ${l.returnable} returnable.`);
    }
    setSubmitting(true);
    try {
      const res = await client.post(`/sales/${sale.id}/return`, { items, reason });
      toast.success('Items returned. Stock and balances have been reconciled.');
      onReturned();
      onClose();
      const newReturnIndex = res.data.data.returns.length - 1;
      navigate(`/receipt/${sale.id}/return/${newReturnIndex}`);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not process this return.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Return Items — ${sale.receiptNumber}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={!anySelected}>
            Confirm Return
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Enter how many units of each item the customer is returning. Stock will be restored to inventory and the
          invoice balance, customer debt and account will be reconciled automatically.
        </p>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">Item</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase text-slate-500">Sold</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase text-slate-500">Already Returned</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase text-slate-500">Return Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.item} className={l.returnable <= 0 ? 'opacity-50' : ''}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{l.name}</p>
                    <p className="text-xs text-slate-400">{formatCurrency(l.unitPrice)} each</p>
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums">{l.quantity}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{l.returnedQuantity || 0}</td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      min="0"
                      max={l.returnable}
                      step="1"
                      disabled={l.returnable <= 0}
                      value={quantities[l.item] || ''}
                      onChange={(e) => setQuantities((q) => ({ ...q, [l.item]: e.target.value }))}
                      className="w-20 text-center tabular-nums"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
        <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold">
          <span>Return Value</span>
          <span className="tabular-nums">{formatCurrency(previewAmount)}</span>
        </div>
      </div>
    </Modal>
  );
}

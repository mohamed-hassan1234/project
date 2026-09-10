import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Textarea } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import SupplierPicker from './SupplierPicker.jsx';
import PurchaseItemPicker from './PurchaseItemPicker.jsx';

export default function PurchaseFormModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [supplier, setSupplier] = useState(null);
  const [lines, setLines] = useState([]);
  const [paidAmount, setPaidAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const totalCost = useMemo(() => lines.reduce((sum, l) => sum + (Number(l.unitCost) || 0) * (Number(l.quantity) || 0), 0), [lines]);

  const handleAddItem = (product) => {
    setLines((prev) => {
      if (prev.find((l) => l.itemId === product.id)) return prev;
      return [...prev, { itemId: product.id, name: product.name, quantity: 1, unitCost: product.costPrice || '' }];
    });
  };

  const updateLine = (itemId, key, value) => {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, [key]: value } : l)));
  };

  const removeLine = (itemId) => setLines((prev) => prev.filter((l) => l.itemId !== itemId));

  const reset = () => {
    setSupplier(null);
    setLines([]);
    setPaidAmount('');
    setNotes('');
  };

  const handleSubmit = async () => {
    if (!supplier) {
      toast.error('Please select or create a supplier.');
      return;
    }
    if (lines.length === 0) {
      toast.error('Add at least one item to the purchase.');
      return;
    }
    for (const l of lines) {
      if (!l.quantity || Number(l.quantity) <= 0) {
        toast.error(`Enter a valid quantity for "${l.name}".`);
        return;
      }
      if (l.unitCost === '' || Number(l.unitCost) < 0) {
        toast.error(`Enter a valid unit cost for "${l.name}".`);
        return;
      }
    }

    setSaving(true);
    try {
      await client.post('/purchases', {
        supplierId: supplier.id,
        items: lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
        paidAmount: Number(paidAmount) || 0,
        notes,
      });
      toast.success('Purchase recorded. Inventory has been updated.');
      reset();
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not record purchase.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Purchase" size="xl">
      <div className="space-y-5">
        <SupplierPicker active={supplier} onSelect={setSupplier} onClear={() => setSupplier(null)} />

        <div>
          <PurchaseItemPicker onAdd={handleAddItem} />
          {lines.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">Item</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold uppercase text-slate-500">Qty</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">Unit Cost</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">Subtotal</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {lines.map((l) => (
                    <tr key={l.itemId}>
                      <td className="px-3 py-2 font-medium text-slate-800">{l.name}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="1"
                          value={l.quantity}
                          onChange={(e) => updateLine(l.itemId, 'quantity', e.target.value)}
                          className="w-20 rounded-md border border-slate-200 py-1 text-center text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.unitCost}
                          onChange={(e) => updateLine(l.itemId, 'unitCost', e.target.value)}
                          className="w-24 rounded-md border border-slate-200 py-1 text-right text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">
                        {formatCurrency((Number(l.unitCost) || 0) * (Number(l.quantity) || 0))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => removeLine(l.itemId)} className="rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Paid Amount">
            <Input type="number" min="0" step="0.01" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} placeholder="0.00" />
          </FormField>
          <FormField label="Notes">
            <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </FormField>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
          <span className="text-sm font-medium text-slate-600">Total Cost</span>
          <span className="text-lg font-bold text-slate-900">{formatCurrency(totalCost)}</span>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            Complete Purchase
          </Button>
        </div>
      </div>
    </Modal>
  );
}

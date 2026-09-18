import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';

const emptyForm = {
  name: '',
  serialNumber: '',
  category: '',
  unit: 'pcs',
  costPrice: '',
  sellingPrice: '',
  expiryDate: '',
};

// Lets the cashier create a brand-new Inventory item without leaving the
// Sales Invoice, reusing the exact same canonical InventoryItem model/API
// (POST /inventory) as the Inventory page's own item form -- this never
// creates a second, conflicting product identity.
export default function AddNewItemModal({ open, initialName = '', onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    if (!open) return;
    setForm({ ...emptyForm, name: initialName });
    setErrors({});
    client.get('/categories').then((res) => setCategories(res.data.data)).catch(() => setCategories([]));
  }, [open, initialName]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Item name is required.';
    if (form.costPrice === '' || Number(form.costPrice) < 0) e.costPrice = 'Enter a valid cost price.';
    if (form.sellingPrice === '' || Number(form.sellingPrice) < 0) e.sellingPrice = 'Enter a valid selling price.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        serialNumber: form.serialNumber.trim(),
        costPrice: Number(form.costPrice),
        sellingPrice: Number(form.sellingPrice),
        expiryDate: form.expiryDate || null,
        category: form.category || null,
      };
      const res = await client.post('/inventory', payload);
      toast.success(`"${res.data.data.name}" added to Inventory. Receive stock through Stock before selling it.`);
      onCreated(res.data.data);
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not create item.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add New Item" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Item Name" required error={errors.name}>
          <Input autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Paracetamol 500mg" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Category">
            <Select value={form.category} onChange={set('category')}>
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Serial Number">
            <Input value={form.serialNumber} onChange={set('serialNumber')} placeholder="Optional" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Cost Price" required error={errors.costPrice}>
            <Input type="number" step="0.01" min="0" value={form.costPrice} onChange={set('costPrice')} placeholder="0.00" />
          </FormField>
          <FormField label="Selling Price / Rate" required error={errors.sellingPrice}>
            <Input type="number" step="0.01" min="0" value={form.sellingPrice} onChange={set('sellingPrice')} placeholder="0.00" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Unit">
            <Input value={form.unit} onChange={set('unit')} placeholder="pcs, kg, bag..." />
          </FormField>
          <FormField label="Expiry Date">
            <Input type="date" value={form.expiryDate} onChange={set('expiryDate')} />
          </FormField>
        </div>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          This creates the product with 0 stock. Receive quantity through Stock before it can be sold.
        </p>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving}>Add &amp; Use in This Sale</Button>
        </div>
      </form>
    </Modal>
  );
}

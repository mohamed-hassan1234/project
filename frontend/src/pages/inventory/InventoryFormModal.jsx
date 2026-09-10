import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';

const emptyForm = {
  name: '',
  sku: '',
  barcode: '',
  category: '',
  description: '',
  quantity: '0',
  unit: 'pcs',
  costPrice: '',
  sellingPrice: '',
  lowStockThreshold: '5',
  expiryDate: '',
  supplier: '',
};

export default function InventoryFormModal({ open, onClose, item, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  useEffect(() => {
    if (!open) return;
    client.get('/categories').then((res) => setCategories(res.data.data));
    client.get('/suppliers?limit=100').then((res) => setSuppliers(res.data.data));
  }, [open]);

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name || '',
        sku: item.sku || '',
        barcode: item.barcode || '',
        category: item.category || '',
        description: item.description || '',
        quantity: String(item.quantity ?? 0),
        unit: item.unit || 'pcs',
        costPrice: String(item.costPrice ?? ''),
        sellingPrice: String(item.sellingPrice ?? ''),
        lowStockThreshold: String(item.lowStockThreshold ?? 5),
        expiryDate: item.expiryDate ? item.expiryDate.slice(0, 10) : '',
        supplier: item.supplier?._id || item.supplier || '',
      });
    } else {
      setForm(emptyForm);
    }
    setErrors({});
  }, [item, open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Item name is required.';
    if (form.costPrice === '' || Number(form.costPrice) < 0) e.costPrice = 'Enter a valid cost price.';
    if (form.sellingPrice === '' || Number(form.sellingPrice) < 0) e.sellingPrice = 'Enter a valid selling price.';
    if (Number(form.quantity) < 0) e.quantity = 'Quantity cannot be negative.';
    if (Number(form.lowStockThreshold) < 0) e.lowStockThreshold = 'Cannot be negative.';
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
        quantity: Number(form.quantity),
        costPrice: Number(form.costPrice),
        sellingPrice: Number(form.sellingPrice),
        lowStockThreshold: Number(form.lowStockThreshold),
        expiryDate: form.expiryDate || null,
        supplier: form.supplier || null,
      };
      if (item) {
        await client.put(`/inventory/${item.id}`, payload);
        toast.success('Item updated successfully.');
      } else {
        await client.post('/inventory', payload);
        toast.success('Item added to inventory.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save item.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={item ? 'Edit Item' : 'Add Inventory Item'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-6">
        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Basic Information</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Item Name" required error={errors.name}>
              <Input value={form.name} onChange={set('name')} placeholder="e.g. Rice (5kg bag)" />
            </FormField>
            <FormField label="Category">
              <Input list="category-options" value={form.category} onChange={set('category')} placeholder="e.g. Groceries" />
              <datalist id="category-options">
                {categories.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </FormField>
            <FormField label="SKU / Item Code">
              <Input value={form.sku} onChange={set('sku')} placeholder="e.g. RICE-5KG" />
            </FormField>
            <FormField label="Barcode">
              <Input value={form.barcode} onChange={set('barcode')} placeholder="Optional" />
            </FormField>
          </div>
          <div className="mt-4">
            <FormField label="Description">
              <Textarea rows={2} value={form.description} onChange={set('description')} placeholder="Optional notes about this item" />
            </FormField>
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Pricing</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Cost Price" required error={errors.costPrice}>
              <Input type="number" step="0.01" min="0" value={form.costPrice} onChange={set('costPrice')} placeholder="0.00" />
            </FormField>
            <FormField label="Selling Price" required error={errors.sellingPrice}>
              <Input type="number" step="0.01" min="0" value={form.sellingPrice} onChange={set('sellingPrice')} placeholder="0.00" />
            </FormField>
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Stock Information</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Quantity" error={errors.quantity}>
              <Input type="number" min="0" value={form.quantity} onChange={set('quantity')} />
            </FormField>
            <FormField label="Unit">
              <Input value={form.unit} onChange={set('unit')} placeholder="pcs, kg, bag..." />
            </FormField>
            <FormField label="Low Stock Threshold" error={errors.lowStockThreshold}>
              <Input type="number" min="0" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />
            </FormField>
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Supplier &amp; Expiration</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Supplier">
              <Select value={form.supplier} onChange={set('supplier')}>
                <option value="">No supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Expiry Date">
              <Input type="date" value={form.expiryDate} onChange={set('expiryDate')} />
            </FormField>
          </div>
        </section>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {item ? 'Save Changes' : 'Add Item'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

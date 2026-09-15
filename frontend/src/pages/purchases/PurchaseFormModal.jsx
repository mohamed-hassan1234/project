import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import SupplierPicker from './SupplierPicker.jsx';

export default function PurchaseFormModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [supplier, setSupplier] = useState(null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const refresh = () => client.get('/accounts').then(r => setAccounts(r.data.data.accounts.filter(a => a.isActive))).catch(() => toast.error('Could not load account balances.'));
  useEffect(() => { if (open) { refresh(); setSupplier(null); setAmount(''); setAccountId(''); setSupplierInvoiceNumber(''); } }, [open]);
  const account = accounts.find(a => a.id === accountId);
  const insufficient = account && Number(amount) > account.currentBalance;
  async function save() {
    if (!supplier || !account || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return toast.error('Select supplier, payment account, and a positive amount.');
    setSaving(true);
    try {
      await client.post('/purchases', { supplierId: supplier.id, supplierInvoiceNumber, amount: Number(amount), purchaseAccountId: accountId });
      toast.success('Purchase invoice paid.'); onSaved(); onClose();
    } catch (err) { toast.error(err.friendlyMessage || 'Could not save invoice.'); refresh(); }
    finally { setSaving(false); }
  }
  return <Modal open={open} onClose={onClose} title="New Purchase Invoice" size="md">
    <div className="space-y-4">
      <SupplierPicker active={supplier} onSelect={setSupplier} onClear={() => setSupplier(null)} />
      <FormField label="Our / Internal Invoice Number"><Input value="Automatically generated on save (PUR)" readOnly /></FormField>
      <FormField label="Supplier Invoice / Serial Number"><Input value={supplierInvoiceNumber} onChange={e => setSupplierInvoiceNumber(e.target.value)} /></FormField>
      <FormField label="Amount" required><Input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></FormField>
      <FormField label="Payment Account" required><Select value={accountId} onChange={e => { setAccountId(e.target.value); refresh(); }}><option value="">Select account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormField>
      {account && <div className="rounded-lg bg-slate-50 p-3 text-sm">Available Balance: {formatCurrency(account.currentBalance)}<br />Balance After: {formatCurrency(account.currentBalance - Number(amount || 0))}</div>}
      {insufficient && <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700"><strong>INSUFFICIENT BALANCE</strong><p>This account does not have enough balance to pay this invoice.</p><p>Available: {formatCurrency(account.currentBalance)} · Required: {formatCurrency(Number(amount))} · Short: {formatCurrency(Number(amount) - account.currentBalance)}</p><p>Choose another payment account.</p></div>}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={insufficient || !account} onClick={save}>Save Purchase Invoice</Button></div>
    </div>
  </Modal>;
}

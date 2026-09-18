import { useMemo, useRef, useState } from 'react';
import { Trash2, Plus, Search, Save } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Textarea } from '../../components/ui/Field.jsx';
import SupplierPicker from '../purchases/SupplierPicker.jsx';

const emptyRow = () => ({ itemName: '', quantity: '', cost: '' });

// A manually-entered archive of a supplier's paper invoice, saved exactly
// as typed. This never touches Stock or Inventory -- see
// supplierInvoiceArchiveController.createArchive on the backend. It is a
// separate, additional workflow from the "From Stock" tab (which derives a
// document from real Stock Entries); this one is for recording a supplier's
// invoice as its own standalone reference record, searchable later by its
// serial number, independent of anything Stock does with quantities.
export default function ManualSupplierInvoiceArchive() {
  const toast = useToast();
  const [supplier, setSupplier] = useState(null);
  const [serialNumber, setSerialNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([emptyRow()]);
  const [saving, setSaving] = useState(false);

  const [searchSerial, setSearchSerial] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null); // null = not searched yet
  const [viewing, setViewing] = useState(null);

  const nameRefs = useRef({});

  const grandTotal = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.cost) || 0), 0),
    [rows]
  );

  const setRow = (index, key, value) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)));

  const addRow = (focus = true) => {
    setRows((prev) => [...prev, emptyRow()]);
    if (focus) {
      setTimeout(() => nameRefs.current[rows.length]?.focus(), 0);
    }
  };

  const removeRow = (index) => setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const handleLastCellKeyDown = (index, e) => {
    const isLastRow = index === rows.length - 1;
    if (isLastRow && e.key === 'Tab' && !e.shiftKey && rows[index].itemName.trim()) {
      e.preventDefault();
      addRow();
    }
  };

  const resetForm = () => {
    setSupplier(null);
    setSerialNumber('');
    setNotes('');
    setRows([emptyRow()]);
  };

  const handleSave = async () => {
    if (!serialNumber.trim()) {
      toast.error('Enter the Shop/Supplier Serial Number.');
      return;
    }
    const validRows = rows.filter((r) => r.itemName.trim());
    if (!validRows.length) {
      toast.error('Add at least one row.');
      return;
    }
    for (const r of validRows) {
      if (!Number(r.quantity) || Number(r.quantity) <= 0) {
        toast.error(`Enter a valid quantity for "${r.itemName}".`);
        return;
      }
      if (r.cost === '' || Number(r.cost) < 0) {
        toast.error(`Enter a valid cost for "${r.itemName}".`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await client.post('/supplier-invoice-archives', {
        serialNumber: serialNumber.trim(),
        supplierId: supplier?.id || null,
        rows: validRows.map((r) => ({ itemName: r.itemName.trim(), quantity: Number(r.quantity), cost: Number(r.cost) })),
        notes,
      });
      toast.success(`Supplier invoice archive ${res.data.data.archiveNumber} saved.`);
      resetForm();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save this archive.');
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = async () => {
    if (!searchSerial.trim()) return;
    setSearching(true);
    setViewing(null);
    try {
      const res = await client.get('/supplier-invoice-archives', { params: { serial: searchSerial.trim() } });
      setSearchResults(res.data.data);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Search failed.');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card dense title="New Supplier Invoice Archive" subtitle="Enter exactly what the supplier's paper invoice shows -- this never changes Stock or Inventory">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Supplier (optional)">
            <SupplierPicker active={supplier} onSelect={setSupplier} onClear={() => setSupplier(null)} />
          </FormField>
          <FormField label="Shop/Supplier Serial Number" required>
            <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="e.g. 585858" />
          </FormField>
        </div>

        <div className="mt-4 max-h-[420px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <colgroup>
              <col className="w-[50%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[5%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Item Name</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-slate-500">Qty</th>
                <th className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Cost</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">
                    <input
                      ref={(el) => { nameRefs.current[i] = el; }}
                      value={row.itemName}
                      onChange={(e) => setRow(i, 'itemName', e.target.value)}
                      placeholder="Item name..."
                      className="w-full rounded-md border border-transparent px-2 py-1.5 text-sm outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={row.quantity}
                      onChange={(e) => setRow(i, 'quantity', e.target.value)}
                      className="no-spinner w-full rounded-md border border-slate-200 px-2 py-1.5 text-center text-sm tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.cost}
                      onChange={(e) => setRow(i, 'cost', e.target.value)}
                      onKeyDown={(e) => handleLastCellKeyDown(i, e)}
                      className="no-spinner w-full rounded-md border border-slate-200 px-2 py-1.5 text-right text-sm tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right text-sm font-semibold tabular-nums text-slate-900">
                    {formatCurrency((Number(row.quantity) || 0) * (Number(row.cost) || 0))}
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <button type="button" tabIndex={-1} onClick={() => removeRow(i)} className="rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={() => addRow()} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50">
            <Plus className="h-3.5 w-3.5" /> Add Row
          </button>
          <div className="text-right">
            <p className="text-xs uppercase text-slate-400">Grand Total</p>
            <p className="text-lg font-bold text-slate-900">{formatCurrency(grandTotal)}</p>
          </div>
        </div>

        <div className="mt-3">
          <FormField label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Optional" />
          </FormField>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={handleSave} loading={saving}>
            <Save className="h-4 w-4" /> Save Archive
          </Button>
        </div>
      </Card>

      <Card dense title="Search Previous Archives">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              value={searchSerial}
              onChange={(e) => setSearchSerial(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search by Shop/Supplier Serial Number..."
            />
          </div>
          <Button variant="secondary" onClick={handleSearch} loading={searching}>Search</Button>
        </div>

        {searchResults !== null && (
          <div className="mt-3">
            {searchResults.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Wax natiijo ah lama helin.</p>
            ) : (
              <div className="space-y-2">
                {searchResults.map((a) => (
                  <div key={a.id} className="rounded-lg border border-slate-100 p-3">
                    <button type="button" onClick={() => setViewing(viewing?.id === a.id ? null : a)} className="flex w-full items-center justify-between text-left">
                      <div>
                        <p className="text-sm font-semibold text-indigo-600">{a.archiveNumber} · Serial: {a.serialNumber}</p>
                        <p className="text-xs text-slate-400">{a.supplierName || 'No supplier on file'} · {formatDateTime(a.createdAt)}</p>
                      </div>
                      <span className="text-sm font-bold tabular-nums text-slate-800">{formatCurrency(a.grandTotal)}</span>
                    </button>
                    {viewing?.id === a.id && (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 text-left uppercase text-slate-400">
                              <th className="py-1 font-medium">Item</th>
                              <th className="py-1 text-center font-medium">Qty</th>
                              <th className="py-1 text-right font-medium">Cost</th>
                              <th className="py-1 text-right font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.rows.map((r, i) => (
                              <tr key={i} className="border-b border-slate-50">
                                <td className="py-1 text-slate-700">{r.itemName}</td>
                                <td className="py-1 text-center text-slate-600">{r.quantity}</td>
                                <td className="py-1 text-right text-slate-600">{formatCurrency(r.cost)}</td>
                                <td className="py-1 text-right font-medium text-slate-800">{formatCurrency(r.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {a.notes && <p className="mt-2 text-xs text-slate-500">Notes: {a.notes}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ShoppingCart, ClipboardList, Lock, Pencil } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { Input, Label } from '../../components/ui/Field.jsx';
import AccountSelect from '../../components/AccountSelect.jsx';
import CustomerSearchBox from './CustomerSearchBox.jsx';
import SellerItemsGrid from './SellerItemsGrid.jsx';
import DraftsPanel from './DraftsPanel.jsx';

export default function POSPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCloseDay = user?.role === 'admin' || user?.role === 'manager';
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');

  const [customer, setCustomer] = useState(null);
  const [lines, setLines] = useState([]);
  const [discount, setDiscount] = useState('0');
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [editReceiptNumber, setEditReceiptNumber] = useState('');

  const [drafts, setDrafts] = useState([]);
  const [draftsLoading, setDraftsLoading] = useState(true);

  const loadDrafts = useCallback(() => {
    setDraftsLoading(true);
    client
      .get('/sales/drafts/today')
      .then((res) => setDrafts(res.data.data))
      .catch(() => setDrafts([]))
      .finally(() => setDraftsLoading(false));
  }, []);

  useEffect(() => loadDrafts(), [loadDrafts]);

  // Edit mode: load an existing Draft's items/customer/payment into the cart.
  useEffect(() => {
    if (!editId) return;
    setLoadingDraft(true);
    (async () => {
      try {
        const saleRes = await client.get(`/sales/${editId}`);
        const sale = saleRes.data.data;
        if (sale.status !== 'DRAFT') {
          toast.error('This invoice is no longer a pending Draft.');
          navigate('/pos', { replace: true });
          return;
        }
        const customerRes = await client.get(`/customers/${sale.customer}`);
        setCustomer(customerRes.data.data);
        setEditReceiptNumber(sale.receiptNumber);
        setDiscount(String(sale.discount || 0));
        setPaidAmount(sale.paidAmount ? String(sale.paidAmount) : '');
        setPaymentAccountId(sale.paymentAccount || null);

        // Since editing releases this draft's reservation before re-reserving,
        // the ceiling for each line is its current available stock PLUS the
        // quantity this draft already holds.
        const withAvailability = await Promise.all(
          sale.items.map(async (i) => {
            const itemRes = await client.get(`/inventory/${i.item}`);
            const item = itemRes.data.data;
            return {
              itemId: i.item,
              name: i.name,
              itemCode: i.itemCode,
              serialNumber: i.serialNumber,
              unitPrice: i.unitPrice,
              quantity: i.quantity,
              available: item.availableQuantity + i.quantity,
            };
          })
        );
        setLines(withAvailability);
      } catch (err) {
        toast.error(err.friendlyMessage || 'Could not load this draft invoice.');
        navigate('/pos', { replace: true });
      } finally {
        setLoadingDraft(false);
      }
    })();
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0), [lines]);
  const discountNum = Math.min(Number(discount) || 0, subtotal);
  const total = Math.max(0, subtotal - discountNum);
  const paidNum = Math.min(Number(paidAmount) || 0, total);
  const remaining = Math.max(0, total - paidNum);
  const hasOverStock = lines.some((l) => l.quantity > l.available || l.quantity <= 0);
  const needsAccount = paidNum > 0 && !paymentAccountId;
  const canComplete = !submitting && !!customer && lines.length > 0 && !hasOverStock && !needsAccount;

  const handleAddLine = (product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === product.id);
      if (existing) {
        if (existing.quantity >= product.availableQuantity) {
          toast.error(`Only ${product.availableQuantity} of "${product.name}" available to sell right now.`);
          return prev;
        }
        return prev.map((l) => (l.itemId === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          itemId: product.id,
          name: product.name,
          itemCode: product.itemCode,
          serialNumber: product.serialNumber,
          unitPrice: product.sellingPrice,
          quantity: 1,
          available: product.availableQuantity,
        },
      ];
    });
  };

  const handleQuantityChange = (itemId, qty) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.itemId !== itemId) return l;
        const bounded = Math.max(1, Math.round(qty) || 1);
        return { ...l, quantity: bounded };
      })
    );
  };

  const handleRemove = (itemId) => setLines((prev) => prev.filter((l) => l.itemId !== itemId));

  const resetSale = () => {
    setCustomer(null);
    setLines([]);
    setDiscount('0');
    setPaidAmount('');
    setPaymentAccountId(null);
    setEditReceiptNumber('');
  };

  const handleSubmit = async () => {
    if (!customer) {
      toast.error('Please select or create a customer first.');
      return;
    }
    if (lines.length === 0) {
      toast.error('Add at least one product to the sale.');
      return;
    }
    const overStock = lines.find((l) => l.quantity > l.available);
    if (overStock) {
      toast.error(`"${overStock.name}" exceeds available stock.`);
      return;
    }
    if (needsAccount) {
      toast.error('Please select a payment account for the amount being paid.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        customerId: customer.id,
        items: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        discount: discountNum,
        paidAmount: paidNum,
        paymentAccountId,
      };
      let saleId;
      if (editId) {
        const res = await client.put(`/sales/${editId}`, payload);
        saleId = res.data.data.id;
        toast.success(`Draft invoice ${res.data.data.receiptNumber} updated.`);
      } else {
        const res = await client.post('/sales', payload);
        saleId = res.data.data.id;
        toast.success(`Pending invoice ${res.data.data.receiptNumber} created. It will become final at Close Day.`);
      }
      resetSale();
      loadDrafts();
      navigate(`/receipt/${saleId}`);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save this invoice.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Seller / POS"
        subtitle="Find the customer, add products, and create the pending invoice"
        actions={
          canCloseDay && (
            <Link to="/pos/close-day">
              <Button variant="secondary">
                <Lock className="h-4 w-4" /> Close Day
              </Button>
            </Link>
          )
        }
      />

      {editId && (
        <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700">
          <Pencil className="h-4 w-4" /> Editing Draft Invoice {editReceiptNumber || editId}
          {loadingDraft && <span className="text-indigo-400">(loading...)</span>}
        </div>
      )}

      <Card>
        <CustomerSearchBox activeCustomer={customer} onSelect={setCustomer} onClear={() => setCustomer(null)} cartTotal={total} paidAmount={paidNum} />
      </Card>

      <Card title="Sale Items" subtitle="Add products to this invoice">
        <SellerItemsGrid
          lines={lines}
          onAddLine={handleAddLine}
          onQuantityChange={handleQuantityChange}
          onRemoveLine={handleRemove}
          disabled={submitting}
          focusTrigger={customer?.id}
        />
      </Card>

      <Card title="Payment" subtitle="Review totals and record what the customer is paying now">
        <div className="mx-auto max-w-md space-y-2.5 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span className="font-medium tabular-nums text-slate-800">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <Label>Discount</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="w-28 text-right tabular-nums"
              disabled={submitting}
            />
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-2.5 text-base font-bold text-slate-900">
            <span>Grand Total</span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Label>Amount Paid</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              className="w-28 text-right tabular-nums"
              disabled={submitting}
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <Label>Payment Account</Label>
            <div className="w-48">
              <AccountSelect value={paymentAccountId} onChange={setPaymentAccountId} disabled={submitting} placeholder="Select account..." />
            </div>
          </div>
          {needsAccount && <p className="text-right text-xs font-medium text-rose-600">Select an account to record this payment.</p>}

          <div className={`flex justify-between rounded-lg px-3 py-2 font-semibold tabular-nums ${remaining > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
            <span className="font-semibold">{remaining > 0 ? 'Outstanding Balance (added to debt)' : 'Fully Paid'}</span>
            <span>{formatCurrency(remaining)}</span>
          </div>

          <Button className="mt-3 w-full" size="lg" loading={submitting} disabled={!canComplete} onClick={handleSubmit}>
            <ShoppingCart className="h-4 w-4" /> {editId ? 'Save Changes to Draft' : 'Create Pending Invoice'}
          </Button>
          <p className="text-center text-xs text-slate-400">
            {editId ? 'This draft stays PENDING until Close Day confirms it.' : 'This invoice is PENDING until Close Day confirms it.'}
          </p>
        </div>
      </Card>

      <Card
        title={
          <span className="flex items-center gap-1.5">
            <ClipboardList className="h-4 w-4" /> Today's Pending Invoices
          </span>
        }
        subtitle="Editable until Close Day"
        actions={<Badge color="amber">{drafts.length}</Badge>}
      >
        <DraftsPanel drafts={drafts} loading={draftsLoading} onChanged={loadDrafts} />
      </Card>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input, Label } from '../../components/ui/Field.jsx';
import CustomerSearchBox from './CustomerSearchBox.jsx';
import SellerItemsGrid from './SellerItemsGrid.jsx';

export default function POSPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [lines, setLines] = useState([]);
  const [discount, setDiscount] = useState('0');
  const [paidAmount, setPaidAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0), [lines]);
  const discountNum = Math.min(Number(discount) || 0, subtotal);
  const total = Math.max(0, subtotal - discountNum);
  const paidNum = Math.min(Number(paidAmount) || 0, total);
  const remaining = Math.max(0, total - paidNum);
  const hasOverStock = lines.some((l) => l.quantity > l.available || l.quantity <= 0);
  const canComplete = !submitting && !!customer && lines.length > 0 && !hasOverStock;

  const handleAddLine = (product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === product.id);
      if (existing) {
        if (existing.quantity >= product.quantity) {
          toast.error(`Only ${product.quantity} of "${product.name}" available in stock.`);
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
          available: product.quantity,
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
  };

  const handleCompleteSale = async () => {
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

    setSubmitting(true);
    try {
      const res = await client.post('/sales', {
        customerId: customer.id,
        items: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        discount: discountNum,
        paidAmount: paidNum,
      });
      toast.success(`Sale completed! Receipt ${res.data.data.receiptNumber}`);
      resetSale();
      navigate(`/receipt/${res.data.data.id}`);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not complete the sale.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Seller / POS" subtitle="Find the customer, add products, and complete the sale" />

      <Card>
        <CustomerSearchBox activeCustomer={customer} onSelect={setCustomer} onClear={() => setCustomer(null)} cartTotal={total} paidAmount={paidNum} />
      </Card>

      <Card title="Sale Items" subtitle="Add products to this sale">
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

          <div className={`flex justify-between rounded-lg px-3 py-2 font-semibold tabular-nums ${remaining > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
            <span className="font-semibold">{remaining > 0 ? 'Outstanding Balance (added to debt)' : 'Fully Paid'}</span>
            <span>{formatCurrency(remaining)}</span>
          </div>

          <Button className="mt-3 w-full" size="lg" loading={submitting} disabled={!canComplete} onClick={handleCompleteSale}>
            <ShoppingCart className="h-4 w-4" /> Complete Sale
          </Button>
        </div>
      </Card>
    </div>
  );
}

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
import ProductSearchBox from './ProductSearchBox.jsx';
import Cart from './Cart.jsx';

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

  const handleAddProduct = (product) => {
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
          sku: product.sku,
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
        const bounded = Math.max(1, Math.min(qty || 1, l.available));
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
    <div>
      <PageHeader title="Seller / POS" subtitle="Find the customer, add products, and complete the sale" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CustomerSearchBox
              activeCustomer={customer}
              onSelect={setCustomer}
              onClear={() => setCustomer(null)}
              cartTotal={total}
              paidAmount={paidNum}
            />
          </Card>

          <Card title="Products">
            <ProductSearchBox onAdd={handleAddProduct} />
            <div className="mt-4">
              <Cart lines={lines} onQuantityChange={handleQuantityChange} onRemove={handleRemove} />
            </div>
          </Card>
        </div>

        <div>
          <Card className="sticky top-4" title="Sale Summary">
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-medium text-slate-800">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <Label>Discount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-28 text-right"
                />
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2.5 text-base font-bold text-slate-900">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <Label>Paid Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  className="w-28 text-right"
                />
              </div>

              <div className={`flex justify-between rounded-lg px-3 py-2 font-semibold ${remaining > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                <span>{remaining > 0 ? 'Remaining (added to debt)' : 'Fully Paid'}</span>
                <span>{formatCurrency(remaining)}</span>
              </div>
            </div>

            <Button className="mt-5 w-full" size="lg" loading={submitting} onClick={handleCompleteSale}>
              <ShoppingCart className="h-4 w-4" /> Complete Sale
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

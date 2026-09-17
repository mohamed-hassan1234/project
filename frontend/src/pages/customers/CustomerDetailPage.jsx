import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Wallet, Receipt, History, FileText, Pencil, XCircle, Undo2, Printer } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import PayDebtModal from './PayDebtModal.jsx';
import ReturnItemsModal from './ReturnItemsModal.jsx';
import logo from '../../images/logo.png';

const LEDGER_LABELS = {
  SALE_CREDIT: { label: 'Debt Created', color: 'red' },
  PAYMENT: { label: 'Debt Payment', color: 'green' },
  ADJUSTMENT: { label: 'Adjustment', color: 'blue' },
  SALE_VOID: { label: 'Sale Voided', color: 'slate' },
  REFUND: { label: 'Refund', color: 'amber' },
};

const INVOICE_STATUS_LABEL = { DRAFT: 'Draft', CONFIRMED: 'Completed', CANCELLED: 'Cancelled' };

// DRAFT invoices are deliberately never posted to outstandingCents (see
// customerController.getCustomerStatement) -- so a $0-paid Draft would
// otherwise read as "Fully Paid". CONFIRMED/CANCELLED already carry the
// correct, ledger-authoritative outstanding value.
function invoiceBalance(sale) {
  return sale.status === 'DRAFT' ? Math.max(0, sale.total - sale.paidAmount) : sale.outstanding;
}

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [data, setData] = useState(null);
  const [debt, setDebt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [returnSale, setReturnSale] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null); // { sale, mode: 'cancel' | 'reverse' }
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      client.get(`/customers/${id}/history`, { params: { from: from || undefined, to: to || undefined, status: status || undefined } }),
      client.get(`/customers/${id}/debt`),
    ])
      .then(([historyRes, debtRes]) => {
        setData(historyRes.data.data);
        setDebt(debtRes.data.data);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load customer.'))
      .finally(() => setLoading(false));
  }, [id, from, to, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load]);

  const handleCancelConfirm = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const path = cancelTarget.mode === 'reverse' ? `/sales/${cancelTarget.sale.id}/reverse` : `/sales/${cancelTarget.sale.id}/cancel`;
      await client.post(path, { reason: cancelTarget.mode === 'reverse' ? 'Cancelled by customer' : 'Cancelled by seller' });
      toast.success(cancelTarget.mode === 'reverse' ? 'Invoice cancelled and reversed.' : 'Draft invoice cancelled.');
      setCancelTarget(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel this invoice.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !data) return <PageSpinner />;
  if (!data) return null;

  const { customer, sales, timeline } = data;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print">
        <Link to="/customers" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Link>
        <div className="flex gap-2">
          <Link to={`/customers/${id}/statement`}>
            <Button variant="secondary">
              <FileText className="h-4 w-4" /> Print Complete Customer Statement
            </Button>
          </Link>
          <Button onClick={() => setPayOpen(true)} disabled={customer.balance <= 0}>
            <Wallet className="h-4 w-4" /> Pay Debt
          </Button>
        </div>
      </div>

      <div id="print-area">
        <Card className="mb-6 no-print">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{customer.name}</h1>
              <p className="text-sm text-slate-500">{customer.phone || 'No phone on file'}</p>
              <p className="mt-1 text-xs text-slate-400">Customer since {formatDate(customer.createdAt)}</p>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs uppercase text-slate-400">Total Purchased</p>
                <p className="text-lg font-bold text-slate-800">{formatCurrency(customer.totalPurchased)}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Total Paid</p>
                <p className="text-lg font-bold text-slate-800">{formatCurrency(customer.totalPaid)}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-400">Outstanding Balance</p>
                <p className={`text-lg font-bold ${customer.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {formatCurrency(customer.balance)}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {debt && debt.invoices.length > 0 && (
          <Card className="mb-6 no-print" title={`Where This Debt Came From (${debt.invoices.length} invoice${debt.invoices.length > 1 ? 's' : ''})`}>
            <div className="space-y-2">
              {debt.invoices.map((inv) => (
                <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2.5">
                  <div>
                    <Link to={`/receipt/${inv.id}`} className="text-sm font-semibold text-indigo-600 hover:underline">
                      {inv.receiptNumber}
                    </Link>
                    <p className="text-xs text-slate-400">{formatDate(inv.createdAt)}</p>
                  </div>
                  <div className="flex gap-4 text-xs text-slate-500">
                    <span>
                      Original Total: <strong className="text-slate-700">{formatCurrency(inv.total)}</strong>
                    </span>
                    <span>
                      Paid at Sale: <strong className="text-slate-700">{formatCurrency(inv.paidAtSale)}</strong>
                    </span>
                    <span className="font-semibold text-rose-600">Remaining: {formatCurrency(inv.outstanding)}</span>
                  </div>
                </div>
              ))}
              <div className="flex justify-end border-t border-slate-100 pt-2 text-sm font-bold text-rose-700">
                Total Debt: {formatCurrency(debt.totalOutstanding)}
              </div>
            </div>
          </Card>
        )}

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 no-print">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </FormField>
            <FormField label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </FormField>
            <FormField label="Invoice Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="DRAFT">Draft</option>
                <option value="CONFIRMED">Completed</option>
              </Select>
            </FormField>
          </div>
          <Button variant="secondary" onClick={() => printReport('portrait')} disabled={sales.length === 0}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>

        <Card className="mb-6" title={`Invoices (${sales.length})`}>
          {/* Print-only branded statement header -- screen navigation, filter
              controls and per-invoice action buttons never appear here. */}
          <div className="mb-4 hidden print:block">
            <div className="flex flex-col items-center text-center">
              <img src={logo} alt={BUSINESS.name} className="h-14 w-auto object-contain" />
              <h1 className="mt-1 text-base font-bold tracking-wide text-slate-900">{BUSINESS.name}</h1>
              <p className="text-xs text-slate-500">{BUSINESS.addressLine}</p>
              <p className="text-xs text-slate-500">{BUSINESS.phone}</p>
            </div>
            <div className="my-3 border-t border-dashed border-slate-300" />
            <p className="text-center text-base font-bold uppercase tracking-wide text-slate-900">Customer Invoice Statement</p>
            <div className="my-3 border-t border-dashed border-slate-300" />
            <div className="flex flex-wrap items-start justify-between gap-4 text-xs">
              <div>
                <p className="text-slate-400">Customer</p>
                <p className="font-semibold text-slate-800">{customer.name}</p>
                {customer.phone && <p className="text-slate-500">{customer.phone}</p>}
              </div>
              <div className="text-right">
                <p className="text-slate-400">Date Range</p>
                <p className="font-semibold text-slate-800">{from || to ? `${from || 'Start'} – ${to || 'Today'}` : 'All History'}</p>
                <p className="mt-1 text-slate-400">Invoice Filter</p>
                <p className="font-semibold text-slate-800">{status ? INVOICE_STATUS_LABEL[status] : 'All'}</p>
              </div>
            </div>
            <div className="my-3 border-t border-dashed border-slate-300" />
          </div>

          {sales.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No invoices found for the selected filters.</p>
          ) : (
            <div className="space-y-2.5">
              {sales.map((s) => {
                const balance = invoiceBalance(s);
                return (
                  <div key={s.id} className="rounded-lg border border-slate-100 p-3" style={{ pageBreakInside: 'avoid' }}>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Receipt className="h-3.5 w-3.5 text-slate-400 no-print" />
                        <span className="text-sm font-semibold text-slate-800">{s.receiptNumber}</span>
                        {s.status === 'CANCELLED' && <Badge color="red">Cancelled</Badge>}
                        {s.status === 'DRAFT' && <Badge color="amber">Pending</Badge>}
                        {s.returnCount > 0 && <Badge color="blue">{s.returnCount} return{s.returnCount > 1 ? 's' : ''}</Badge>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-400">{formatDateTime(s.createdAt)}</span>
                        <Link to={`/receipt/${s.id}`} className="text-xs font-semibold text-indigo-600 hover:underline no-print">
                          View / Print
                        </Link>
                        {s.status === 'DRAFT' && (
                          <>
                            <button
                              className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-600 no-print"
                              onClick={() => navigate(`/pos?edit=${s.id}`)}
                            >
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                            <button
                              className="flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-700 no-print"
                              onClick={() => setCancelTarget({ sale: s, mode: 'cancel' })}
                            >
                              <XCircle className="h-3.5 w-3.5" /> Cancel
                            </button>
                          </>
                        )}
                        {s.status === 'CONFIRMED' && canManage && (
                          <>
                            <button
                              className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-600 no-print"
                              onClick={() => setReturnSale(s)}
                            >
                              <Undo2 className="h-3.5 w-3.5" /> Return Items
                            </button>
                            <button
                              className="flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-700 no-print"
                              onClick={() => setCancelTarget({ sale: s, mode: 'reverse' })}
                            >
                              <XCircle className="h-3.5 w-3.5" /> Cancel Invoice
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-left uppercase text-slate-400">
                          <th className="w-6 py-1 font-medium">No</th>
                          <th className="py-1 font-medium">Description</th>
                          <th className="py-1 text-center font-medium">Qty</th>
                          <th className="py-1 text-right font-medium">Price</th>
                          <th className="py-1 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.items.map((it, i) => (
                          <tr key={i} className="border-b border-slate-50">
                            <td className="py-1 text-slate-400">{i + 1}</td>
                            <td className="py-1 text-slate-700">
                              {it.name}
                              {it.returnedQuantity > 0 && <span className="ml-1 text-[10px] text-blue-600">({it.returnedQuantity} returned)</span>}
                            </td>
                            <td className="py-1 text-center text-slate-600">{it.quantity}</td>
                            <td className="py-1 text-right text-slate-500">{formatCurrency(it.unitPrice)}</td>
                            <td className="py-1 text-right font-medium text-slate-800">{formatCurrency(it.subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="mt-1.5 flex flex-wrap justify-end gap-4 border-t border-slate-100 pt-1.5 text-xs text-slate-500">
                      <span>
                        Invoice Total: <strong className="text-slate-800">{formatCurrency(s.total)}</strong>
                      </span>
                      <span>
                        Paid: <strong className="text-slate-800">{formatCurrency(s.paidAmount)}</strong>
                      </span>
                      <span className={balance > 0 ? 'font-semibold text-rose-600' : 'text-emerald-600'}>
                        {balance > 0 ? `Balance: ${formatCurrency(balance)}` : 'Fully Paid'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {sales.length > 0 && (
            <div className="mt-5 border-t border-slate-200 pt-4 print:mt-8 print:border-t-2 print:border-dashed">
              <p className="mb-2 hidden text-center text-sm font-bold uppercase tracking-wide text-slate-700 print:block">Statement Summary</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Number of Invoices</p>
                  <p className="text-base font-bold text-slate-800">{sales.length}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Total Invoice Amount</p>
                  <p className="text-base font-bold text-slate-800">{formatCurrency(sales.reduce((sum, s) => sum + s.total, 0))}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Total Paid</p>
                  <p className="text-base font-bold text-slate-800">{formatCurrency(sales.reduce((sum, s) => sum + s.paidAmount, 0))}</p>
                </div>
                <div className="rounded-lg bg-rose-50 px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-rose-500">Total Outstanding</p>
                  <p className="text-base font-bold text-rose-700">{formatCurrency(sales.reduce((sum, s) => sum + invoiceBalance(s), 0))}</p>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="no-print" title={<span className="flex items-center gap-1.5"><History className="h-4 w-4" /> Transaction Timeline</span>}>
          {!timeline || timeline.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No balance-affecting transactions yet.</p>
          ) : (
            <ol className="space-y-2.5">
              {timeline.map((t) => {
                const meta = LEDGER_LABELS[t.type] || { label: t.type, color: 'slate' };
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge color={meta.color}>{meta.label}</Badge>
                      <span className="text-slate-600">{t.description}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span className={t.amount > 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>
                        {t.amount > 0 ? '+' : ''}
                        {formatCurrency(t.amount)}
                      </span>
                      <span>{formatDateTime(t.createdAt)}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      <PayDebtModal open={payOpen} onClose={() => setPayOpen(false)} customerId={id} onPaid={load} />
      <ReturnItemsModal open={!!returnSale} onClose={() => setReturnSale(null)} sale={returnSale} onReturned={load} />
      <ConfirmDialog
        open={!!cancelTarget}
        title={cancelTarget?.mode === 'reverse' ? 'Cancel Invoice' : 'Cancel Draft Invoice'}
        message={
          cancelTarget?.mode === 'reverse'
            ? `Cancel confirmed invoice ${cancelTarget?.sale.receiptNumber}? Stock will be restored, the customer's balance and any paid amount will be reversed, and the invoice will be marked Cancelled (never deleted).`
            : `Cancel draft invoice ${cancelTarget?.sale.receiptNumber}? Reserved stock and any pending payment will be released.`
        }
        confirmLabel={cancelTarget?.mode === 'reverse' ? 'Cancel Invoice' : 'Cancel Draft'}
        variant="danger"
        loading={cancelling}
        onConfirm={handleCancelConfirm}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}

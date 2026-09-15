import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock, AlertTriangle, Printer, CheckCircle2 } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime, formatTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty } from '../../components/ui/Table.jsx';
import Modal from '../../components/ui/Modal.jsx';
import logo from '../../images/logo.png';

export default function CloseDayPage() {
  const toast = useToast();
  const { user } = useAuth();
  const canCloseDay = user?.role === 'admin' || user?.role === 'manager';
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/day-close/preview')
      .then((res) => setPreview(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load Close Day review.'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load]);

  const handleConfirmClose = async () => {
    setClosing(true);
    try {
      const res = await client.post('/day-close/confirm');
      setResult(res.data.data);
      setConfirmOpen(false);
      toast.success(`Day closed. ${res.data.data.invoiceCount} invoice(s) confirmed.`);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not close the day.');
    } finally {
      setClosing(false);
    }
  };

  if (loading) return <PageSpinner />;

  if (result) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between no-print">
          <Link to="/pos" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
            <ArrowLeft className="h-4 w-4" /> Back to POS
          </Link>
          <Button onClick={() => printReport('portrait')}>
            <Printer className="h-4 w-4" /> Print Day Summary
          </Button>
        </div>

        <div id="print-area" className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm print:rounded-none print:border-0 print:shadow-none">
          <div className="flex flex-col items-center text-center">
            <img src={logo} alt={BUSINESS.name} className="h-16 w-auto object-contain" />
            <h1 className="mt-1 text-base font-bold tracking-wide text-slate-900">{BUSINESS.name}</h1>
            <p className="text-xs text-slate-500">{BUSINESS.addressLine}</p>
            <p className="text-xs text-slate-500">{BUSINESS.phone}</p>
          </div>

          <div className="my-4 flex items-center justify-center gap-2 border-y border-dashed border-slate-300 py-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <p className="text-lg font-bold text-slate-900">Day Closed Successfully</p>
          </div>

          <p className="text-center text-sm text-slate-500">{formatDate(result.businessDate)}</p>
          <p className="text-center text-xs text-slate-400">Closed by {result.closedByName} at {formatDateTime(result.closedAt)}</p>

          <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <SummaryRow label="Invoices Confirmed" value={result.invoiceCount} />
            <SummaryRow label="Revenue" value={formatCurrency(result.revenue)} />
            <SummaryRow label="Cost of Goods Sold" value={formatCurrency(result.cogs)} />
            <SummaryRow label="Gross Profit" value={formatCurrency(result.grossProfit)} highlight />
            <SummaryRow label="Payments Received" value={formatCurrency(result.cashCollected)} />
            <SummaryRow label="Credit Created" value={formatCurrency(result.customerCredit)} />
          </div>

          <div className="mt-6 border-t border-dashed border-slate-300 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Payment Breakdown</p>
            {result.paymentBreakdown.length === 0 ? (
              <p className="text-sm text-slate-400">No payments recorded today.</p>
            ) : (
              <div className="space-y-1.5">
                {result.paymentBreakdown.map((p) => (
                  <div key={p.account} className="flex justify-between text-sm">
                    <span className="text-slate-600">{p.accountName}</span>
                    <span className="font-semibold text-slate-800">{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print">
        <Link to="/pos" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to POS
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Close Day / Xir Maalinta</h1>
          <p className="mt-0.5 text-sm text-slate-500">{formatDate(preview.date)} · Review every pending invoice before confirming</p>
        </div>
        {canCloseDay ? (
          <Button size="lg" disabled={!preview.readyToConfirm} onClick={() => setConfirmOpen(true)}>
            <Lock className="h-4 w-4" /> Close Day
          </Button>
        ) : (
          <Badge color="slate">Only an admin or manager can close the day</Badge>
        )}
      </div>

      {preview.problems.length > 0 && (
        <Card className="mb-6 border-rose-200 bg-rose-50">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            <div>
              <p className="font-semibold text-rose-700">Some draft invoices need attention before the day can be closed</p>
              <ul className="mt-2 space-y-1 text-sm text-rose-600">
                {preview.problems.map((p) => (
                  <li key={p.saleId}>
                    <strong>{p.receiptNumber}</strong>: {p.issues.join(' ')}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label="Draft Invoices" value={preview.totalDraftInvoices} />
        <StatBox label="Total Draft Value" value={formatCurrency(preview.totalDraftValue)} />
        <StatBox label="Payments Received" value={formatCurrency(preview.totalPaymentsReceived)} />
        <StatBox label="Reserved Units" value={preview.totalReservedUnits} />
      </div>

      <Table>
        <THead>
          <tr>
            <Th>Invoice</Th>
            <Th>Customer</Th>
            <Th>Created Time</Th>
            <Th>Items</Th>
            <Th>Total</Th>
            <Th>Paid</Th>
            <Th>Status</Th>
          </tr>
        </THead>
        <TBody>
          {preview.invoices.length === 0 ? (
            <TableEmpty colSpan={7} message="No pending invoices to close." />
          ) : (
            preview.invoices.map((inv) => (
              <tr key={inv.id}>
                <Td className="font-medium text-slate-900">{inv.receiptNumber}</Td>
                <Td>{inv.customerName}</Td>
                <Td>{formatTime(inv.createdAt)}</Td>
                <Td>{inv.items.length} item(s)</Td>
                <Td>{formatCurrency(inv.total)}</Td>
                <Td>{formatCurrency(inv.paidAmount)}</Td>
                <Td>
                  <Badge color="amber">Pending</Badge>
                </Td>
              </tr>
            ))
          )}
        </TBody>
      </Table>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm Close Day" size="sm">
        <p className="text-sm text-slate-600">
          You are about to close <strong>{formatDate(preview.date)}</strong>.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          <strong>{preview.totalDraftInvoices}</strong> invoice{preview.totalDraftInvoices === 1 ? '' : 's'} worth{' '}
          <strong>{formatCurrency(preview.totalDraftValue)}</strong> will be confirmed permanently.
        </p>
        <p className="mt-2 text-sm font-medium text-rose-600">After confirmation they can no longer be directly edited or deleted.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={closing}>
            Cancel
          </Button>
          <Button onClick={handleConfirmClose} loading={closing}>
            <Lock className="h-4 w-4" /> Confirm Close Day
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value, highlight }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${highlight ? 'bg-emerald-50' : 'bg-slate-50'}`}>
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

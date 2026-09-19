import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import Card from '../../components/ui/Card.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';

// Every entry here is one immutable Close Day snapshot -- values come from
// the saved DayClose document, never recalculated from today's (possibly
// different) Account balances or Sale records.
export default function CloseDayHistoryPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/day-close/history', { params: { page, limit: 20 } })
      .then((res) => {
        setItems(res.data.data);
        setPagination(res.data.pagination);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load closing history.'))
      .finally(() => setLoading(false));
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load]);

  if (loading && items.length === 0) return <PageSpinner />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Link to="/pos/close-day" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Close Day
        </Link>
      </div>
      <h1 className="mb-1 text-xl font-bold text-slate-900">Daily Closing History</h1>
      <p className="mb-6 text-sm text-slate-500">Every past Close Day, exactly as it was recorded at the time.</p>

      {items.length === 0 ? (
        <Card><p className="py-8 text-center text-sm text-slate-400">No closings recorded yet.</p></Card>
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <Card key={d.id}>
              <button className="flex w-full items-center justify-between text-left" onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                <div>
                  <p className="font-semibold text-slate-900">{formatDate(d.businessDate)}</p>
                  <p className="text-xs text-slate-400">Closed {formatDateTime(d.closedAt)} by {d.closedByName}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900">{formatCurrency(d.revenue)}</p>
                  <p className="text-xs text-slate-400">{d.invoiceCount} invoice{d.invoiceCount === 1 ? '' : 's'}</p>
                </div>
              </button>

              {expanded === d.id && (
                <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Revenue" value={formatCurrency(d.revenue)} />
                    <Stat label="COGS" value={formatCurrency(d.cogs)} />
                    <Stat label="Gross Profit" value={formatCurrency(d.grossProfit)} />
                    <Stat label="Credit Created" value={formatCurrency(d.customerCredit)} />
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">By Account</p>
                    {d.paymentBreakdown.length === 0 ? (
                      <p className="text-xs text-slate-400">No payments that day.</p>
                    ) : (
                      d.paymentBreakdown.map((p) => (
                        <div key={p.account} className="flex justify-between text-sm">
                          <span className="text-slate-600">{p.accountName}</span>
                          <span className="font-medium text-slate-800">{formatCurrency(p.amount)}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">By Cashier</p>
                    {d.cashierBreakdown.length === 0 ? (
                      <p className="text-xs text-slate-400">No payments that day.</p>
                    ) : (
                      d.cashierBreakdown.map((c) => (
                        <div key={c.user || c.userName} className="flex justify-between text-sm">
                          <span className="text-slate-600">{c.userName}</span>
                          <span className="font-medium text-slate-800">{formatCurrency(c.total)}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Accounts Reset That Day</p>
                    {d.accountBalancesBeforeReset.length === 0 ? (
                      <p className="text-xs text-slate-400">Nothing needed resetting.</p>
                    ) : (
                      d.accountBalancesBeforeReset.map((a) => (
                        <div key={a.account} className="flex justify-between text-sm">
                          <span className="text-slate-600">{a.accountName}</span>
                          <span className="text-slate-500">{formatCurrency(a.balanceBeforeReset)} &rarr; $0.00</span>
                        </div>
                      ))
                    )}
                  </div>

                  {d.invoiceReferences.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Invoices ({d.invoiceReferences.length})</p>
                      <p className="text-xs text-slate-500">{d.invoiceReferences.join(', ')}</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4">
        <Pagination {...pagination} onChange={setPage} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-base font-bold text-slate-800">{value}</p>
    </div>
  );
}

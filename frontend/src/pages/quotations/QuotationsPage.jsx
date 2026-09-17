import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import { Input, Select, FormField } from '../../components/ui/Field.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import DateRangeFilter from '../../components/reports/DateRangeFilter.jsx';
import PrintReportHeader from '../../components/reports/PrintReportHeader.jsx';
import { printReport } from '../../utils/printReport.js';

const STATUSES = ['Pending', 'Accepted', 'Rejected', 'Expired', 'Converted'];
export default function QuotationsPage({ report = false }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const search = useDebounce(q, 250);
  const [status, setStatus] = useState('');
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = { q: search, status, page, limit: 20, ...(from || to ? { from, to } : range !== 'all' ? { range } : {}) };
    Promise.all([client.get('/quotations', { params }), report ? client.get('/reports/quotations', { params }) : Promise.resolve(null)])
      .then(([rows, stats]) => { if (active) { setResult(rows.data); setSummary(stats?.data.data); } })
      .catch(err => { if (active) { setResult(null); toast.error(err.friendlyMessage || 'Unable to load quotations.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, status, range, from, to, page, refresh, report]);
  return <div className="space-y-4 min-w-0">
    <PageHeader title={report ? 'Quotation Report' : 'Quotation'} subtitle="Pre-sale documents; no stock or financial posting until an invoice is created and confirmed." actions={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setRefresh(v => v + 1)} disabled={loading}>Refresh</Button>{report ? <Button onClick={() => printReport('landscape')} disabled={loading}>Print Report</Button> : <Link to="/quotations/new"><Button>+ Add Quotation</Button></Link>}</div>} />
    <div className="grid gap-3 sm:grid-cols-2 no-print">
      <FormField label="Quotation Number / Customer"><Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search quotations" /></FormField>
      <FormField label="Status"><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</Select></FormField>
    </div>
    <DateRangeFilter allowAll range={range} onRangeChange={value => { setRange(value); setFrom(''); setTo(''); setPage(1); }} from={from} to={to} onFromChange={v => { setFrom(v); setPage(1); }} onToChange={v => { setTo(v); setPage(1); }} />
    <div id={report ? 'print-area' : undefined}>
      {report && <PrintReportHeader title="Quotation Report" rangeLabel={from || to ? `${from || 'Start'} – ${to || 'Today'}` : range} />}
      {report && summary && <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[['Total Quotations', summary.totalQuotations], ...STATUSES.map(s => [`${s} Quotations`, summary.counts[s]]), ['Total Quotation Amount', formatCurrency(summary.totalQuotationAmount)]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-lg font-semibold">{value}</p></div>)}</div>}
      <Card><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500">{['Quotation', 'Customer', 'Date', 'Expiry Date', 'Status', 'Grand Total', 'Converted Invoice'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>
        {loading ? <tr><td colSpan={7} className="p-8 text-center">Loading quotations…</td></tr> : !result ? <tr><td colSpan={7} className="p-8 text-center">Unable to load quotations. Please refresh.</td></tr> : result.data.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-slate-500">No quotations found.</td></tr> : result.data.map(row => <tr key={row.id} className="border-b border-slate-100"><td className="p-3"><Link className="text-indigo-700 hover:underline" to={`/quotations/${row.id}`}>{row.quotationNumber}</Link></td><td className="p-3">{row.customerName}</td><td className="p-3">{formatDate(row.date)}</td><td className="p-3">{formatDate(row.expiryDate)}</td><td className="p-3">{row.status}</td><td className="p-3 tabular-nums">{formatCurrency(row.grandTotal)}</td><td className="p-3">{row.convertedInvoice ? <Link className="text-indigo-700 hover:underline" to={`/receipt/${row.convertedInvoice}`}>{row.convertedInvoiceNumber}</Link> : '—'}</td></tr>)}
      </tbody></table></div>{result && <div className="no-print"><Pagination {...result.pagination} onChange={setPage} /></div>}</Card>
      {report && <p className="mt-3 text-xs text-slate-500">Totals cover all matching quotations. Detail table: page {page} of {result?.pagination.pages || 1}. Open a quotation to view its products, prices and discounts. Quotation amounts are not sales revenue.</p>}
    </div>
  </div>;
}

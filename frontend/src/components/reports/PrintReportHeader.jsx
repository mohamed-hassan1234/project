import { BUSINESS } from '../../constants/business.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import logo from '../../images/logo.png';

// Rendered only when printing (`hidden print:block`) so the interactive
// screen dashboard never shows a duplicate header - the printed document
// gets its own clean, branded page top instead of a screenshot of the UI.
export default function PrintReportHeader({ title, rangeLabel }) {
  return (
    <div className="hidden print:block">
      <div className="flex flex-col items-center text-center">
        <img src={logo} alt={BUSINESS.name} className="h-14 w-auto object-contain" />
        <h1 className="mt-1 text-base font-bold tracking-wide text-slate-900">{BUSINESS.name}</h1>
        <p className="text-xs text-slate-500">{BUSINESS.addressLine}</p>
        <p className="text-xs text-slate-500">{BUSINESS.phone}</p>
      </div>

      <div className="my-3 border-t border-slate-300" />

      <div className="text-center">
        <p className="text-lg font-bold uppercase tracking-wide text-slate-900">{title}</p>
        {rangeLabel && <p className="mt-0.5 text-sm text-slate-600">{rangeLabel}</p>}
        <p className="mt-0.5 text-xs text-slate-400">Generated: {formatDateTime(new Date())}</p>
      </div>

      <div className="my-4 border-t border-dashed border-slate-300" />
    </div>
  );
}

export function formatRangeLabel(range) {
  if (!range) return '';
  const from = range.from ? formatDate(range.from) : null;
  const to = range.to ? formatDate(range.to) : null;
  if (from && to) return `${from} - ${to}`;
  return from || to || '';
}

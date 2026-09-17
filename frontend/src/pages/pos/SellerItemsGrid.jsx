import { useEffect, useRef, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency } from '../../utils/format.js';

// A compact, keyboard-first item cell used for the trailing "add new item"
// row. Search matches by item name, Item ID, or Serial Number.
function ItemSearchCell({ onSelect, placeholder, inputRef }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const debounced = useDebounce(query, 200);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!debounced.trim()) {
      setResults([]);
      return;
    }
    client
      .get('/inventory/search', { params: { q: debounced } })
      .then((res) => setResults(res.data.data))
      .catch(() => setResults([]));
  }, [debounced]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const choose = (item) => {
    if (!item || item.availableQuantity <= 0) return;
    onSelect(item);
    setQuery('');
    setResults([]);
    setOpen(false);
    setHighlighted(0);
  };

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      // Tab behaves like Enter here so the seller can move through the grid
      // by keyboard alone -- it commits the highlighted match instead of
      // tabbing past the row with nothing selected.
      e.preventDefault();
      choose(results[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-md border border-transparent bg-transparent py-1.5 pl-7 pr-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-1 focus:ring-indigo-200"
        />
      </div>

      {open && query.trim() && (
        <div className="absolute z-30 mt-1 w-80 max-w-[85vw] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-slate-400">No matching items</div>
          ) : (
            <ul className="max-h-60 overflow-y-auto py-1">
              {results.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(r);
                    }}
                    disabled={r.availableQuantity <= 0}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                      i === highlighted ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{r.name}</p>
                      <p className="truncate text-slate-400">
                        {r.itemCode}
                        {r.serialNumber ? ` · SN: ${r.serialNumber}` : ''} ·{' '}
                        {r.availableQuantity <= 0 ? 'Out of stock/reserved' : `${r.availableQuantity} ${r.unit} avail.`}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-700">{formatCurrency(r.sellingPrice)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function RemoveButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
      title="Remove row"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

// Compact, spreadsheet-style item entry grid for the Seller/POS sale. Rows
// are added by selecting an item in the always-present trailing search row;
// pressing Tab from a quantity input advances naturally (via normal DOM tab
// order) straight into the next row's item search field, since the "add
// another item" row always exists and remove buttons are excluded from the
// tab sequence.
// The grid renders two structurally different trees (a table for
// sm-and-up, stacked cards below sm) so only one is ever visible at a
// time via CSS. Each needs its own refs -- sharing one ref between both
// would let the hidden tree's DOM node silently "win" the ref callback
// and swallow every focus() call.
function focusFirstVisible(...els) {
  for (const el of els) {
    if (el && el.offsetParent !== null) {
      el.focus();
      return el;
    }
  }
  return null;
}

export default function SellerItemsGrid({ lines, onAddLine, onQuantityChange, onRemoveLine, disabled, focusTrigger }) {
  const qtyRefsDesktop = useRef({});
  const qtyRefsMobile = useRef({});
  const newRowRefDesktop = useRef(null);
  const newRowRefMobile = useRef(null);
  const lastAddedIdRef = useRef(null);

  useEffect(() => {
    if (lastAddedIdRef.current) {
      const id = lastAddedIdRef.current;
      const el = focusFirstVisible(qtyRefsDesktop.current[id], qtyRefsMobile.current[id]);
      el?.select();
      lastAddedIdRef.current = null;
    }
  }, [lines]);

  useEffect(() => {
    if (focusTrigger) {
      focusFirstVisible(newRowRefDesktop.current, newRowRefMobile.current);
    }
  }, [focusTrigger]);

  const handleSelect = (item) => {
    lastAddedIdRef.current = item.id;
    onAddLine(item);
  };

  return (
    <div>
      {/* Desktop / tablet: invoice-style grid */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 sm:block">
        <table className="w-full text-sm">
          <colgroup>
            <col className="w-[55%]" />
            <col className="w-[12%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
            <col className="w-[5%]" />
          </colgroup>
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Item</th>
              <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-slate-500">Qty</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Rate</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Amount</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {lines.map((line) => (
              <tr key={line.itemId} className={line.quantity > line.available ? 'bg-rose-50/40' : ''}>
                <td className="px-3 py-2">
                  <p className="truncate text-sm font-medium text-slate-800">{line.name}</p>
                  <p className="truncate text-xs font-normal text-slate-400">
                    {line.itemCode}
                    {line.serialNumber ? ` · SN: ${line.serialNumber}` : ''} · {line.available} avail.
                  </p>
                </td>
                <td className="px-2 py-2">
                  <input
                    ref={(el) => {
                      qtyRefsDesktop.current[line.itemId] = el;
                    }}
                    type="number"
                    min={1}
                    step="1"
                    value={line.quantity}
                    disabled={disabled}
                    onChange={(e) => onQuantityChange(line.itemId, Number(e.target.value))}
                    className={`no-spinner mx-auto block w-16 rounded-md border px-2 py-1.5 text-center text-sm tabular-nums focus:outline-none focus:ring-1 ${
                      line.quantity > line.available
                        ? 'border-rose-400 focus:ring-rose-200'
                        : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-200'
                    }`}
                  />
                  {line.quantity > line.available && (
                    <p className="mt-1 text-center text-[11px] font-normal text-rose-600">Only {line.available} available</p>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatCurrency(line.unitPrice)}</td>
                <td className="px-3 py-2 text-right text-[15px] font-semibold tabular-nums text-slate-900">
                  {formatCurrency(line.unitPrice * line.quantity)}
                </td>
                <td className="px-1 py-2 text-center">
                  <RemoveButton disabled={disabled} onClick={() => onRemoveLine(line.itemId)} />
                </td>
              </tr>
            ))}
            <tr>
              <td className="px-1 py-1.5">
                <ItemSearchCell onSelect={handleSelect} placeholder="Search item, serial number, or item ID..." inputRef={newRowRefDesktop} />
              </td>
              <td className="px-2 py-1.5 text-center text-sm text-slate-300">—</td>
              <td className="px-3 py-1.5 text-right text-sm text-slate-300">—</td>
              <td className="px-3 py-1.5 text-right text-sm text-slate-300">—</td>
              <td className="px-2 py-1.5" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards, one per line, so nothing gets crushed */}
      <div className="space-y-2 sm:hidden">
        {lines.map((line) => (
          <div
            key={line.itemId}
            className={`rounded-lg border p-3 ${line.quantity > line.available ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200 bg-white'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{line.name}</p>
                <p className="truncate text-xs text-slate-400">
                  {line.itemCode}
                  {line.serialNumber ? ` · SN: ${line.serialNumber}` : ''} · {line.available} avail.
                </p>
              </div>
              <RemoveButton disabled={disabled} onClick={() => onRemoveLine(line.itemId)} />
            </div>
            <div className="mt-2.5 grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-xs text-slate-400">Qty</p>
                <input
                  ref={(el) => {
                    qtyRefsMobile.current[line.itemId] = el;
                  }}
                  type="number"
                  min={1}
                  step="1"
                  value={line.quantity}
                  disabled={disabled}
                  onChange={(e) => onQuantityChange(line.itemId, Number(e.target.value))}
                  className={`no-spinner mt-0.5 w-full rounded-md border px-2 py-1.5 text-center tabular-nums focus:outline-none focus:ring-1 ${
                    line.quantity > line.available ? 'border-rose-400' : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-200'
                  }`}
                />
              </div>
              <div>
                <p className="text-xs text-slate-400">Rate</p>
                <p className="mt-2 tabular-nums text-slate-700">{formatCurrency(line.unitPrice)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Amount</p>
                <p className="mt-2 font-semibold tabular-nums text-slate-900">{formatCurrency(line.unitPrice * line.quantity)}</p>
              </div>
            </div>
            {line.quantity > line.available && <p className="mt-1.5 text-xs font-normal text-rose-600">Only {line.available} available</p>}
          </div>
        ))}
        <div className="rounded-lg border border-slate-200 bg-white px-1 py-1">
          <ItemSearchCell onSelect={handleSelect} placeholder="Search item, serial number, or item ID..." inputRef={newRowRefMobile} />
        </div>
        {lines.length === 0 && <p className="px-1 py-2 text-center text-sm text-slate-400">No items yet. Search for a product to begin.</p>}
      </div>
    </div>
  );
}

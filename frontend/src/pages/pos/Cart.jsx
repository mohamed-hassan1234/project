import { Trash2, Minus, Plus } from 'lucide-react';
import { formatCurrency } from '../../utils/format.js';

export default function Cart({ lines, onQuantityChange, onRemove }) {
  if (lines.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-400">
        No products added yet. Search and add products above.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">Product</th>
            <th className="px-3 py-2 text-center text-xs font-semibold uppercase text-slate-500">Qty</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">Unit Price</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">Subtotal</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {lines.map((line) => (
            <tr key={line.itemId}>
              <td className="px-3 py-2.5">
                <p className="font-medium text-slate-800">{line.name}</p>
                <p className="text-xs text-slate-400">
                  {line.sku || 'No SKU'} · {line.available} available
                </p>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center justify-center gap-1.5">
                  <button
                    onClick={() => onQuantityChange(line.itemId, line.quantity - 1)}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={line.available}
                    value={line.quantity}
                    onChange={(e) => onQuantityChange(line.itemId, Number(e.target.value))}
                    className="w-14 rounded-md border border-slate-200 py-1 text-center text-sm"
                  />
                  <button
                    onClick={() => onQuantityChange(line.itemId, line.quantity + 1)}
                    disabled={line.quantity >= line.available}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                {line.quantity > line.available && (
                  <p className="mt-1 text-center text-xs font-medium text-rose-600">Only {line.available} in stock</p>
                )}
              </td>
              <td className="px-3 py-2.5 text-right text-slate-600">{formatCurrency(line.unitPrice)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-slate-800">
                {formatCurrency(line.unitPrice * line.quantity)}
              </td>
              <td className="px-3 py-2.5 text-right">
                <button onClick={() => onRemove(line.itemId)} className="rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Search, Package } from 'lucide-react';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency } from '../../utils/format.js';
import { Input, Label } from '../../components/ui/Field.jsx';

export default function ProductSearchBox({ onAdd }) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 250);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    client
      .get('/inventory/search', { params: { q: debouncedQuery } })
      .then((res) => setResults(res.data.data))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [debouncedQuery]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleAdd = (product) => {
    if (product.quantity <= 0) return;
    onAdd(product);
    setQuery('');
    setResults([]);
    setShowDropdown(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <Label>Add Product</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="pl-9"
          placeholder="Search by name, SKU or barcode..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
        />
      </div>

      {showDropdown && query.trim() && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {searching ? (
            <div className="px-4 py-3 text-sm text-slate-400">Searching...</div>
          ) : results.length > 0 ? (
            <ul className="max-h-72 overflow-y-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => handleAdd(p)}
                    disabled={p.quantity <= 0}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                        <Package className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400">
                          {p.sku || 'No SKU'} · {p.quantity <= 0 ? 'Out of stock' : `${p.quantity} ${p.unit} available`}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-slate-700">{formatCurrency(p.sellingPrice)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-3 text-sm text-slate-500">No products found for "{query}"</div>
          )}
        </div>
      )}
    </div>
  );
}

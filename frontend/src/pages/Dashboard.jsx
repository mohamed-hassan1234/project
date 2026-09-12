import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  Boxes,
  Layers,
  Wallet,
  AlertTriangle,
  PackageX,
  CalendarClock,
  ArrowRight,
} from 'lucide-react';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatCurrency } from '../utils/format.js';
import { BUSINESS } from '../constants/business.js';
import StatCard from '../components/ui/StatCard.jsx';
import Card from '../components/ui/Card.jsx';
import Badge, { stockStatusBadge } from '../components/ui/Badge.jsx';
import { PageSpinner } from '../components/ui/Spinner.jsx';
import logo from '../images/logo.png';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client
      .get('/dashboard')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Failed to load dashboard.'));
    client
      .get('/inventory/alerts/summary')
      .then((res) => setAlerts(res.data.data))
      .catch(() => {});
  }, []);

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!data) return <PageSpinner />;

  const { cards, charts } = data;
  const lowStockRows = (alerts?.lowStock || []).slice(0, 5);

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <img src={logo} alt={BUSINESS.name} className="h-11 w-11 shrink-0 rounded-xl object-contain" />
        <div>
          <p className="text-sm text-slate-500">
            {greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </p>
          <h1 className="text-xl font-bold leading-tight text-slate-900">{BUSINESS.name} — Business Overview</h1>
        </div>
      </div>

      <div className="kpi-grid grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <StatCard label="Today's Sales" value={formatCurrency(cards.todaySales)} icon={DollarSign} tone="indigo" hint={`${cards.todaySalesCount} sale(s)`} />
        <StatCard label="Today's Profit" value={formatCurrency(cards.todayProfit)} icon={TrendingUp} tone="emerald" />
        <StatCard label="Inventory Value" value={formatCurrency(cards.stockValue)} icon={Wallet} tone="indigo" hint="at cost price" />
        <StatCard label="Outstanding Balance" value={formatCurrency(cards.customerDebt)} icon={Wallet} tone="rose" />
      </div>

      <div className="kpi-grid mt-3.5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <StatCard label="Low Stock" value={cards.lowStockCount} icon={AlertTriangle} tone="amber" />
        <StatCard label="Total Items" value={cards.totalInventoryItems} icon={Boxes} tone="slate" hint={`${cards.totalStockQuantity} units in stock`} />
        <StatCard label="Out of Stock" value={cards.outOfStockCount} icon={PackageX} tone="rose" />
        <StatCard label="Expiring / Expired" value={`${cards.nearExpiryCount} / ${cards.expiredCount}`} icon={CalendarClock} tone="amber" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Sales &amp; Profit (last 14 days)" className="chart-container">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={charts.dailySales}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Line type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} dot={false} name="Revenue" />
              <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} dot={false} name="Profit" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Monthly Trend" className="chart-container">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={charts.monthlySales}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Line type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} dot={false} name="Revenue" />
              <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} dot={false} name="Profit" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Top-Selling Items (last 14 days)" className="chart-container">
          {charts.topSelling.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No sales yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={charts.topSelling}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-10} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="quantity" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Quantity Sold" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card
          title="Low Stock Alerts"
          actions={
            <Link to="/inventory" className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          {lowStockRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Nothing low on stock right now.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lowStockRows.map((item) => {
                const stock = stockStatusBadge(item.stockStatus);
                return (
                  <li key={item.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{item.name}</p>
                      <p className="text-xs text-slate-400">
                        {item.itemCode} · {item.quantity} {item.unit} left
                      </p>
                    </div>
                    <Badge color={stock.color}>{stock.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

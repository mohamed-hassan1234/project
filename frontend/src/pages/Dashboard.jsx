import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import client from '../api/client.js';
import { formatCurrency } from '../utils/format.js';
import StatCard from '../components/ui/StatCard.jsx';
import Card from '../components/ui/Card.jsx';
import { PageSpinner } from '../components/ui/Spinner.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    client
      .get('/dashboard')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Failed to load dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageSpinner />;
  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;

  const { cards, charts } = data;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Today's business overview at a glance" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Today's Sales" value={formatCurrency(cards.todaySales)} icon={DollarSign} tone="indigo" hint={`${cards.todaySalesCount} sale(s)`} />
        <StatCard label="Today's Profit" value={formatCurrency(cards.todayProfit)} icon={TrendingUp} tone="emerald" />
        <StatCard label="Inventory Items" value={cards.totalInventoryItems} icon={Boxes} tone="slate" />
        <StatCard label="Stock Quantity" value={cards.totalStockQuantity} icon={Layers} tone="slate" />
        <StatCard label="Stock Value" value={formatCurrency(cards.stockValue)} icon={Wallet} tone="indigo" hint="at cost price" />
        <StatCard label="Customer Debt" value={formatCurrency(cards.customerDebt)} icon={Wallet} tone="rose" />
        <StatCard label="Low Stock" value={cards.lowStockCount} icon={AlertTriangle} tone="amber" />
        <StatCard label="Out of Stock" value={cards.outOfStockCount} icon={PackageX} tone="rose" />
        <StatCard label="Expired Items" value={cards.expiredCount} icon={CalendarClock} tone="rose" />
        <StatCard label="Near Expiry" value={cards.nearExpiryCount} icon={CalendarClock} tone="amber" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Daily Sales & Profit (last 14 days)">
          <ResponsiveContainer width="100%" height={260}>
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

        <Card title="Monthly Sales & Profit Trend">
          <ResponsiveContainer width="100%" height={260}>
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

        <Card title="Top-Selling Items (last 14 days)" className="lg:col-span-2">
          {charts.topSelling.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No sales yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
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
      </div>
    </div>
  );
}

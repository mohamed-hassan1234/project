import StockPage from './pages/stock/StockPage.jsx';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import SalesInvoicePage from './pages/pos/SalesInvoicePage.jsx';
import QuotationsPage from './pages/quotations/QuotationsPage.jsx';
import QuotationDetailPage from './pages/quotations/QuotationDetailPage.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './layouts/AppLayout.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import InventoryPage from './pages/inventory/InventoryPage.jsx';
import InventoryPrintPage from './pages/inventory/InventoryPrintPage.jsx';
import CategoriesPage from './pages/categories/CategoriesPage.jsx';
import POSPage from './pages/pos/POSPage.jsx';
import CloseDayPage from './pages/pos/CloseDayPage.jsx';
import PurchasesPage from './pages/purchases/PurchasesPage.jsx';
import CustomersPage from './pages/customers/CustomersPage.jsx';
import CustomerDetailPage from './pages/customers/CustomerDetailPage.jsx';
import CustomerStatementPage from './pages/customers/CustomerStatementPage.jsx';
import SuppliersPage from './pages/suppliers/SuppliersPage.jsx';
import SupplierDetailPage from './pages/suppliers/SupplierDetailPage.jsx';
import SupplierInvoicesPage from './pages/suppliers/SupplierInvoicesPage.jsx';
import AccountsPage from './pages/accounts/AccountsPage.jsx';
import ReportsPage from './pages/reports/ReportsPage.jsx';
import ReceiptPage from './pages/receipt/ReceiptPage.jsx';
import PaymentReceiptPage from './pages/receipt/PaymentReceiptPage.jsx';
import PurchaseReceiptPage from './pages/receipt/PurchaseReceiptPage.jsx';
import NotFound from './pages/NotFound.jsx';

function POSWorkspace() { const location = useLocation(); return <POSPage key={location.search} />; }

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/inventory/:id/print" element={<InventoryPrintPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/pos" element={<SalesInvoicePage />} />
              <Route path="/pos/new" element={<POSWorkspace />} />
              <Route path="/quotations" element={<QuotationsPage />} />
              <Route path="/quotations/new" element={<QuotationDetailPage key="new" />} />
              <Route path="/quotations/:id" element={<QuotationDetailPage />} />
              <Route path="/pos/close-day" element={<CloseDayPage />} />
              <Route path="/stock" element={<StockPage />} />
              <Route path="/purchases" element={<PurchasesPage />} />
              <Route path="/purchases/:id/receipt" element={<PurchaseReceiptPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/customers/:id" element={<CustomerDetailPage />} />
              <Route path="/customers/:id/statement" element={<CustomerStatementPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
              <Route path="/supplier-invoices" element={<SupplierInvoicesPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/receipt/:id" element={<ReceiptPage />} />
              <Route path="/payment-receipt/:id" element={<PaymentReceiptPage />} />
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}

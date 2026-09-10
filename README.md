# Shop Manager — Inventory + POS + Purchases + Seller + Reporting System

A production-quality inventory, point-of-sale, purchasing, and reporting
system built with React + Vite + Tailwind (frontend), Node.js + Express
(backend), and MongoDB + Mongoose.

## Stack

- **Frontend:** React 19, Vite, Tailwind CSS v4, React Router, Recharts, Axios
- **Backend:** Node.js, Express, Mongoose, JWT auth (jsonwebtoken + bcryptjs)
- **Database:** MongoDB

## Getting Started

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env    # edit MONGO_URI / JWT_SECRET if needed
npm run seed             # creates an admin user + sample inventory
npm run dev               # starts the API on http://localhost:5000
```

Seeded login: **admin / admin123**

### 2. Frontend

```bash
cd frontend
npm install
npm run dev               # starts the app on http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:5000`, so no
frontend `.env` is required in development.

### 3. Production build

```bash
cd frontend
npm run build              # outputs static files to frontend/dist
```

Serve `frontend/dist` behind any static host / reverse proxy, and point it
at the backend's `/api` (set `CLIENT_ORIGIN` in the backend `.env` to your
deployed frontend origin for CORS).

## Architecture notes

- **Money** is stored as integer cents (`*Cents` fields) throughout the
  database to avoid floating-point accounting bugs. The API converts to/from
  decimal dollars at the boundary.
- **Sale/Purchase atomicity**: `backend/src/utils/transaction.js` wraps the
  sale and purchase creation/void flows in a MongoDB session transaction,
  falling back to sequential (non-transactional) execution if the server is
  a standalone instance without replica-set support. For true atomicity in
  production, deploy MongoDB as a replica set (MongoDB Atlas does this by
  default).
- **Historical cost/profit**: every sale line stores the item's cost price
  *at the time of sale*, so profit reports remain accurate even after an
  item's current cost price changes later.
- **Customer search UX**: the POS never uses a customer dropdown. The seller
  types a name, matching customers appear live (debounced), and if none
  match, a customer can be created inline without leaving the sale.
- **Stock validation** happens server-side on every sale — the frontend
  clamps quantities for UX, but the backend is the source of truth and
  rejects overselling.
- **Voiding** sales/purchases (rather than deleting) preserves the audit
  trail: stock and customer/supplier balances are reversed, and the record
  is marked `voided` with a reason.

## Default credentials

| Username | Password | Role  |
|----------|----------|-------|
| admin    | admin123 | admin |

Change this password (or create additional users via `POST /api/auth/register`
while authenticated as an admin) before using this in a real business.

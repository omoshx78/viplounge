const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('vip_lounge_token');
}

export function setSession(token, user) {
  localStorage.setItem('vip_lounge_token', token);
  localStorage.setItem('vip_lounge_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('vip_lounge_token');
  localStorage.removeItem('vip_lounge_user');
}

export function getCurrentUser() {
  const raw = localStorage.getItem('vip_lounge_user');
  return raw ? JSON.parse(raw) : null;
}

async function request(path, { method = 'GET', body, auth = true, params } = {}) {
  let url = `${API_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
    if ([...qs].length) url += `?${qs.toString()}`;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });

  // A 401 on an authenticated request means the token is missing/expired/invalid — every panel
  // in the app would otherwise fail this the same way independently and silently. Handling it
  // once here means the person gets kicked back to login with a clear reason instead of staring
  // at dashboards that look "frozen" with no explanation.
  if (auth && res.status === 401) {
    clearSession();
    sessionStorage.setItem('vip_lounge_session_message', 'Your session expired. Please sign in again.');
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  changePassword: (current_password, new_password) => request('/api/auth/change-password', { method: 'POST', body: { current_password, new_password } }),
  resetPassword: (token, new_password) => request('/api/auth/reset-password', { method: 'POST', body: { token, new_password }, auth: false }),

  lookupPassenger: (passportNumber) => request(`/api/checkin/lookup/${encodeURIComponent(passportNumber)}`, { auth: false }),
  listCorporateAccountsPublic: () => request('/api/checkin/corporate-accounts', { auth: false }),
  submitCheckin: (payload) => request('/api/checkin', { method: 'POST', body: payload, auth: false }),

  staffQueue: () => request('/api/staff/queue'),
  staffVerify: (visitId) => request(`/api/staff/verify/${visitId}`, { method: 'POST' }),
  staffReject: (visitId) => request(`/api/staff/reject/${visitId}`, { method: 'POST' }),
  collectPayment: (visitId, payload) => request(`/api/staff/collect-payment/${visitId}`, { method: 'POST', body: payload }),

  listCashCollections: (params) => request('/api/payments/cash-collections', { params }),
  getExpectedCashTotal: (params) => request('/api/payments/cash-collections/expected-total', { params }),
  createReconciliation: (payload) => request('/api/payments/reconciliations', { method: 'POST', body: payload }),
  listReconciliations: () => request('/api/payments/reconciliations'),

  listVisits: (params) => request('/api/visits', { params }),
  myCorporateAccounts: () => request('/api/visits/my-corporate-accounts'),
  searchSuggest: (q) => request('/api/visits/search-suggest', { params: { q } }),
  summary: (params) => request('/api/visits/summary', { params }),

  listTenants: () => request('/api/admin/tenants'),
  createTenant: (payload) => request('/api/admin/tenants', { method: 'POST', body: payload }),
  listCorporateAccounts: () => request('/api/admin/corporate-accounts'),
  createCorporateAccount: (payload) => request('/api/admin/corporate-accounts', { method: 'POST', body: payload }),
  listRateCards: () => request('/api/admin/rate-cards'),
  createRateCard: (payload) => request('/api/admin/rate-cards', { method: 'POST', body: payload }),
  getPlatformSubscription: () => request('/api/admin/platform-subscription'),
  updatePlatformSubscription: (payload) => request('/api/admin/platform-subscription', { method: 'POST', body: payload }),
  generateSubscriptionCharge: (payload) => request('/api/admin/platform-subscription/generate-charge', { method: 'POST', body: payload }),
  listUsers: () => request('/api/admin/users'),
  createUser: (payload) => request('/api/admin/users', { method: 'POST', body: payload }),
  generateResetLink: (userId) => request(`/api/admin/users/${userId}/generate-reset-link`, { method: 'POST' }),

  listInventoryItems: () => request('/api/inventory/items'),
  inventorySummary: () => request('/api/inventory/summary'),
  itemTransactions: (itemId) => request(`/api/inventory/items/${itemId}/transactions`),
  createInventoryItem: (payload) => request('/api/inventory/items', { method: 'POST', body: payload }),
  updateInventoryItem: (itemId, payload) => request(`/api/inventory/items/${itemId}`, { method: 'PUT', body: payload }),
  adjustInventoryItem: (itemId, payload) => request(`/api/inventory/items/${itemId}/adjust`, { method: 'POST', body: payload }),

  listPayments: (params) => request('/api/payments', { params }),
  createPayment: (payload) => request('/api/payments', { method: 'POST', body: payload }),
  getStatement: (params) => request('/api/payments/statement', { params }),
};

// Client-side CSV export — works for any list of flat objects, no backend round-trip needed.
export function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

// Opens a self-contained, styled printable document in a new tab — used for receipts,
// invoices, and any list-style document that needs a formal print/PDF output distinct from
// just Ctrl+P'ing the live app page. "Download PDF" is just the browser's own print-to-PDF
// destination, so one Print button covers both print and PDF export.
export function openPrintableDocument(title, bodyHtml) {
  const win = window.open('', '_blank');
  if (!win) return; // popup blocked — nothing more we can do without the user's permission
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        body { font-family: 'IBM Plex Sans', Arial, sans-serif; color: #191d2b; margin: 0; padding: 40px; }
        .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #c8a13d; padding-bottom: 16px; margin-bottom: 24px; }
        .doc-header h1 { font-family: Georgia, serif; font-size: 22px; margin: 0; color: #0e1e38; }
        .doc-header .eyebrow { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #9c7a24; font-weight: 700; margin-bottom: 4px; }
        .doc-meta { text-align: right; font-size: 12.5px; color: #6b6558; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
        th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5dcc6; }
        th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b6558; }
        .total-row td { font-weight: 700; font-size: 15px; border-top: 2px solid #0e1e38; border-bottom: none; }
        .print-btn { margin-bottom: 20px; padding: 10px 18px; background: #0e1e38; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
        @media print { .print-btn { display: none; } }
      </style>
    </head>
    <body>
      <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
      ${bodyHtml}
    </body>
    </html>
  `);
  win.document.close();
}

const LOUNGE_NAME = 'Juba International Airport VIP Lounge';

// Shared receipt format — used both right after staff verifies an individual/cash-or-card
// passenger (the moment payment is actually collected) and from the passenger list for any
// already-verified visit. Same document either way.
export function printReceipt(visit) {
  const html = `
    <div class="doc-header">
      <div>
        <div class="eyebrow">Receipt</div>
        <h1>${LOUNGE_NAME}</h1>
      </div>
      <div class="doc-meta">
        Visit ID: ${visit.id}<br />
        ${new Date(visit.visit_datetime || Date.now()).toLocaleString()}
      </div>
    </div>
    <table>
      <tr><th>Passenger</th><td>${visit.full_name}</td></tr>
      <tr><th>Passport</th><td>${visit.passport_number}</td></tr>
      <tr><th>Flight</th><td>${visit.flight_number} (${visit.direction})</td></tr>
      <tr><th>Sponsor</th><td>${visit.corporate_account_name || 'Individual'}</td></tr>
      <tr><th>Payment method</th><td>${visit.payment_type}</td></tr>
    </table>
    <table>
      <tr class="total-row"><td>Amount charged</td><td>$${Number(visit.client_charge).toFixed(2)}</td></tr>
    </table>
  `;
  openPrintableDocument(`Receipt — ${visit.full_name}`, html);
}

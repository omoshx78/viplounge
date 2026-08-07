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

  listVisits: (params) => request('/api/visits', { params }),
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

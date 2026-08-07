import { useEffect, useState } from 'react';
import { api, openPrintableDocument } from '../api/client';
import StatementView from '../components/StatementView';

const LOUNGE_NAME = 'Juba International Airport VIP Lounge';

function PostPaymentForm({ tenants, corporateAccounts, onPosted }) {
  const [form, setForm] = useState({
    payer_type: 'corporate_account', payer_id: '', amount: '',
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: 'bank_transfer', reference_number: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.createPayment({ ...form, amount: Number(form.amount) });
      setSuccess(true);
      setForm(f => ({ ...f, payer_id: '', amount: '', reference_number: '', notes: '' }));
      onPosted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const options = form.payer_type === 'corporate_account' ? corporateAccounts : tenants;

  return (
    <div className="card no-print">
      <h2>Post a payment</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Record a payment received from a corporate account or travel agent against their outstanding balance.
      </p>
      {success && <div className="badge badge-success" style={{ marginBottom: 14 }}>Payment posted</div>}
      <form onSubmit={submit} className="grid grid-3" style={{ alignItems: 'end' }}>
        <div>
          <label>Payer type</label>
          <select value={form.payer_type} onChange={(e) => setForm(f => ({ ...f, payer_type: e.target.value, payer_id: '' }))}>
            <option value="corporate_account">Corporate account</option>
            <option value="tenant">Travel agent</option>
          </select>
        </div>
        <div>
          <label>Account</label>
          <select required value={form.payer_id} onChange={(e) => setForm(f => ({ ...f, payer_id: e.target.value }))}>
            <option value="">Select...</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label>Amount ($)</label>
          <input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} />
        </div>
        <div>
          <label>Payment date</label>
          <input type="date" value={form.payment_date} onChange={(e) => setForm(f => ({ ...f, payment_date: e.target.value }))} />
        </div>
        <div>
          <label>Method</label>
          <select value={form.payment_method} onChange={(e) => setForm(f => ({ ...f, payment_method: e.target.value }))}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="mobile_money">Mobile money</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label>Reference number</label>
          <input value={form.reference_number} onChange={(e) => setForm(f => ({ ...f, reference_number: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Notes (optional)</label>
          <input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
        {error && <p style={{ color: 'var(--danger)', gridColumn: '1 / -1' }}>{error}</p>}
        <button type="submit" disabled={saving}>{saving ? 'Posting...' : 'Post payment'}</button>
      </form>
    </div>
  );
}

function PaymentHistory({ refreshKey }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.listPayments().then(setPayments).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function printHistory() {
    const rowsHtml = payments.map(p => `
      <tr>
        <td>${new Date(p.payment_date).toLocaleDateString()}</td>
        <td>${p.payer_type === 'tenant' ? 'Travel agent' : 'Corporate'}</td>
        <td>${p.payment_method}</td>
        <td>${p.reference_number || '—'}</td>
        <td>$${Number(p.amount).toFixed(2)}</td>
        <td>${p.posted_by_name || '—'}</td>
      </tr>
    `).join('');
    openPrintableDocument('Payment history', `
      <div class="doc-header">
        <div><div class="eyebrow">Payment history</div><h1>${LOUNGE_NAME}</h1></div>
        <div class="doc-meta">Generated ${new Date().toLocaleString()}<br />${payments.length} payments</div>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Payer type</th><th>Method</th><th>Reference</th><th>Amount</th><th>Posted by</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Payment history</h2>
        <button className="secondary no-print" onClick={printHistory}>Print</button>
      </div>
      {loading ? <p>Loading...</p> : error ? (
        <p style={{ color: 'var(--danger)' }}>Couldn't load payments: {error} <button className="secondary" onClick={load}>Retry</button></p>
      ) : (
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Date</th><th>Payer type</th><th>Method</th><th>Reference</th><th>Amount</th><th>Posted by</th></tr></thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id}>
                <td>{new Date(p.payment_date).toLocaleDateString()}</td>
                <td>{p.payer_type === 'tenant' ? 'Travel agent' : 'Corporate'}</td>
                <td>{p.payment_method}</td>
                <td>{p.reference_number || '—'}</td>
                <td>${Number(p.amount).toFixed(2)}</td>
                <td>{p.posted_by_name || '—'}</td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan={6}>No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Cashier() {
  const [tenants, setTenants] = useState([]);
  const [corporateAccounts, setCorporateAccounts] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api.listTenants().then(setTenants).catch(() => setTenants([]));
    api.listCorporateAccounts().then(setCorporateAccounts).catch(() => setCorporateAccounts([]));
  }, []);

  return (
    <div className="app-shell">
      <h1>Cashier</h1>
      <p style={{ color: 'var(--text-muted)' }}>Post payments received from corporate accounts and travel agents, and generate statements of account.</p>
      <PostPaymentForm tenants={tenants} corporateAccounts={corporateAccounts} onPosted={() => setRefreshKey(k => k + 1)} />
      <StatementView tenantOptions={tenants} corporateOptions={corporateAccounts} />
      <PaymentHistory refreshKey={refreshKey} />
    </div>
  );
}

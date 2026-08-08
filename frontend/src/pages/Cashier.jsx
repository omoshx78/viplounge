import { useEffect, useState } from 'react';
import { api, openPrintableDocument } from '../api/client';
import StatementView from '../components/StatementView';

const LOUNGE_NAME = 'Juba International Airport VIP Lounge';

function startOfToday() {
  return new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
}
function now() {
  return new Date().toISOString();
}
function toDatetimeLocal(iso) {
  return iso.slice(0, 16);
}

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
        Record a payment received from a corporate account or travel agent against their outstanding balance — this is for post-paid billing, not individual cash/card passengers (see Cash & card collections below for those).
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
        <h2 style={{ margin: 0 }}>Corporate/agent payment history</h2>
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

// Individual cash/card passengers pay AT THE DESK, at verification time — this lists those
// point-of-sale collections (recorded by staff via "Confirm payment collected"), separate from
// the corporate/agent payments ledger above which is for post-paid billing.
function CashCollectionsPanel() {
  const [from, setFrom] = useState(toDatetimeLocal(startOfToday()));
  const [to, setTo] = useState(toDatetimeLocal(now()));
  const [paymentType, setPaymentType] = useState('');
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.listCashCollections({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), payment_type: paymentType })
      .then(setCollections)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = collections.reduce((sum, c) => sum + Number(c.client_charge), 0);
  const cashTotal = collections.filter(c => c.payment_type === 'cash').reduce((sum, c) => sum + Number(c.client_charge), 0);
  const cardTotal = collections.filter(c => c.payment_type === 'card').reduce((sum, c) => sum + Number(c.client_charge), 0);

  function printCollections() {
    const rowsHtml = collections.map(c => `
      <tr>
        <td>${new Date(c.payment_collected_at).toLocaleString()}</td>
        <td>${c.full_name}</td>
        <td>${c.payment_type}</td>
        <td>${c.payment_reference || '—'}</td>
        <td>$${Number(c.client_charge).toFixed(2)}</td>
        <td>${c.collected_by_name || '—'}</td>
      </tr>
    `).join('');
    openPrintableDocument('Cash & card collections', `
      <div class="doc-header">
        <div><div class="eyebrow">Cash &amp; card collections</div><h1>${LOUNGE_NAME}</h1></div>
        <div class="doc-meta">${new Date(from).toLocaleString()} to ${new Date(to).toLocaleString()}<br />${collections.length} collections</div>
      </div>
      <table>
        <thead><tr><th>Time</th><th>Passenger</th><th>Method</th><th>Reference</th><th>Amount</th><th>Collected by</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <table style="margin-top:20px;">
        <tr><td>Cash total</td><td>$${cashTotal.toFixed(2)}</td></tr>
        <tr><td>Card total</td><td>$${cardTotal.toFixed(2)}</td></tr>
        <tr class="total-row"><td>Total collected</td><td>$${total.toFixed(2)}</td></tr>
      </table>
    `);
  }

  return (
    <div className="card">
      <h2>Cash &amp; card collections</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Individual passengers who paid at the desk during verification. Use this to see what's been collected in a shift.
      </p>
      <div className="grid grid-4 no-print" style={{ alignItems: 'end' }}>
        <div>
          <label>From</label>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label>To</label>
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label>Method</label>
          <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
            <option value="">Cash + Card</option>
            <option value="cash">Cash only</option>
            <option value="card">Card only</option>
          </select>
        </div>
        <button onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!loading && !error && (
        <>
          <div className="grid grid-3" style={{ margin: '16px 0' }}>
            <div className="stat-card"><div className="stat-value">${cashTotal.toFixed(2)}</div><div className="stat-label">Cash total</div></div>
            <div className="stat-card"><div className="stat-value">${cardTotal.toFixed(2)}</div><div className="stat-label">Card total</div></div>
            <div className="stat-card"><div className="stat-value">${total.toFixed(2)}</div><div className="stat-label">All collections</div></div>
          </div>
          <div className="toolbar no-print">
            <button className="secondary" onClick={printCollections}>Print</button>
          </div>
          <table>
            <thead><tr><th>Time</th><th>Passenger</th><th>Method</th><th>Reference</th><th>Amount</th><th>Collected by</th></tr></thead>
            <tbody>
              {collections.map(c => (
                <tr key={c.id}>
                  <td>{new Date(c.payment_collected_at).toLocaleString()}</td>
                  <td>{c.full_name}</td>
                  <td>{c.payment_type}</td>
                  <td>{c.payment_reference || '—'}</td>
                  <td>${Number(c.client_charge).toFixed(2)}</td>
                  <td>{c.collected_by_name || '—'}</td>
                </tr>
              ))}
              {collections.length === 0 && <tr><td colSpan={6}>No collections in this period.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// End-of-shift cash reconciliation: the system computes what SHOULD be in the till (from
// verified, collected, cash visits in the period) — the cashier only ever enters what they
// actually counted, never types in the expected figure themselves.
function ReconciliationPanel() {
  const [from, setFrom] = useState(toDatetimeLocal(startOfToday()));
  const [to, setTo] = useState(toDatetimeLocal(now()));
  const [expected, setExpected] = useState(null);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [loadingExpected, setLoadingExpected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [history, setHistory] = useState([]);

  const loadHistory = () => api.listReconciliations().then(setHistory).catch(() => setHistory([]));
  useEffect(() => { loadHistory(); }, []);

  async function fetchExpected() {
    setLoadingExpected(true);
    setError('');
    setExpected(null);
    try {
      const result = await api.getExpectedCashTotal({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      setExpected(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingExpected(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const result = await api.createReconciliation({
        period_start: new Date(from).toISOString(),
        period_end: new Date(to).toISOString(),
        counted_cash_total: Number(counted),
        notes,
      });
      setSuccess(result);
      setCounted('');
      setNotes('');
      setExpected(null);
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function printReconciliation(r) {
    openPrintableDocument('Cash reconciliation', `
      <div class="doc-header">
        <div><div class="eyebrow">End-of-shift cash reconciliation</div><h1>${LOUNGE_NAME}</h1></div>
        <div class="doc-meta">${new Date(r.period_start).toLocaleString()} to ${new Date(r.period_end).toLocaleString()}</div>
      </div>
      <table>
        <tr><td>Expected (system)</td><td>$${Number(r.expected_cash_total).toFixed(2)}</td></tr>
        <tr><td>Counted (actual)</td><td>$${Number(r.counted_cash_total).toFixed(2)}</td></tr>
        <tr class="total-row"><td>Variance</td><td>${Number(r.variance) >= 0 ? '+' : ''}$${Number(r.variance).toFixed(2)}</td></tr>
      </table>
      ${r.notes ? `<p>Notes: ${r.notes}</p>` : ''}
      <p style="color:#6b6558;font-size:12px;">Reconciled by ${r.reconciled_by_name || '—'} on ${new Date(r.created_at).toLocaleString()}</p>
    `);
  }

  return (
    <div className="card">
      <h2>End-of-shift cash reconciliation</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Pick the shift period, let the system tell you what's expected in the till from cash
        collections, then enter what you actually counted.
      </p>

      <div className="grid grid-3 no-print" style={{ alignItems: 'end' }}>
        <div>
          <label>Shift start</label>
          <input type="datetime-local" value={from} onChange={(e) => { setFrom(e.target.value); setExpected(null); }} />
        </div>
        <div>
          <label>Shift end</label>
          <input type="datetime-local" value={to} onChange={(e) => { setTo(e.target.value); setExpected(null); }} />
        </div>
        <button onClick={fetchExpected} disabled={loadingExpected}>{loadingExpected ? 'Calculating...' : 'Calculate expected cash'}</button>
      </div>

      {expected && (
        <form onSubmit={submit} style={{ marginTop: 16 }}>
          <div className="stat-card" style={{ maxWidth: 280, marginBottom: 14 }}>
            <div className="stat-value">${expected.expected_total.toFixed(2)}</div>
            <div className="stat-label">Expected cash ({expected.count} collections)</div>
          </div>
          <label>Counted cash ($)</label>
          <input required type="number" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
          <label>Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. reason for any variance" />
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Submit reconciliation'}</button>
        </form>
      )}

      {success && (
        <div className="card" style={{ background: 'var(--bg)', marginTop: 16 }}>
          <p style={{ fontSize: 13 }}>
            Reconciliation saved — variance:{' '}
            <strong style={{ color: Number(success.variance) === 0 ? 'var(--success)' : 'var(--danger)' }}>
              {Number(success.variance) >= 0 ? '+' : ''}${Number(success.variance).toFixed(2)}
            </strong>
          </p>
          <button className="secondary" onClick={() => printReconciliation(success)}>Print</button>
        </div>
      )}

      <h3 style={{ marginTop: 20 }}>Recent reconciliations</h3>
      <table>
        <thead><tr><th>Period</th><th>Expected</th><th>Counted</th><th>Variance</th><th>By</th><th></th></tr></thead>
        <tbody>
          {history.map(r => (
            <tr key={r.id}>
              <td>{new Date(r.period_start).toLocaleDateString()} – {new Date(r.period_end).toLocaleDateString()}</td>
              <td>${Number(r.expected_cash_total).toFixed(2)}</td>
              <td>${Number(r.counted_cash_total).toFixed(2)}</td>
              <td style={{ color: Number(r.variance) === 0 ? 'var(--success)' : 'var(--danger)' }}>
                {Number(r.variance) >= 0 ? '+' : ''}${Number(r.variance).toFixed(2)}
              </td>
              <td>{r.reconciled_by_name || '—'}</td>
              <td><button className="secondary no-print" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => printReconciliation(r)}>Print</button></td>
            </tr>
          ))}
          {history.length === 0 && <tr><td colSpan={6}>No reconciliations yet.</td></tr>}
        </tbody>
      </table>
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
      <p style={{ color: 'var(--text-muted)' }}>Post corporate/agent payments, review cash & card collections, generate statements, and reconcile cash at end of shift.</p>
      <CashCollectionsPanel />
      <ReconciliationPanel />
      <PostPaymentForm tenants={tenants} corporateAccounts={corporateAccounts} onPosted={() => setRefreshKey(k => k + 1)} />
      <StatementView tenantOptions={tenants} corporateOptions={corporateAccounts} />
      <PaymentHistory refreshKey={refreshKey} />
    </div>
  );
}

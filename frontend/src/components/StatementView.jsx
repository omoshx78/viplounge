import { useState } from 'react';
import { api, openPrintableDocument } from '../api/client';

const LOUNGE_NAME = 'Juba International Airport VIP Lounge';

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function printStatement(statement, payerLabel) {
  const chargeRows = statement.charges.map(c => `
    <tr>
      <td>${new Date(c.visit_datetime).toLocaleDateString()}</td>
      <td>${c.full_name}</td>
      <td>${c.flight_number}</td>
      <td>${c.department || '—'}</td>
      <td>$${Number(c.client_charge).toFixed(2)}</td>
    </tr>
  `).join('');
  const paymentRows = statement.payments.map(p => `
    <tr>
      <td>${new Date(p.payment_date).toLocaleDateString()}</td>
      <td>${p.payment_method}</td>
      <td>${p.reference_number || '—'}</td>
      <td>$${Number(p.amount).toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <div class="doc-header">
      <div><div class="eyebrow">Statement of account</div><h1>${LOUNGE_NAME}</h1></div>
      <div class="doc-meta">
        Account: ${payerLabel}<br />
        Period: ${statement.period_start} to ${statement.period_end}<br />
        Generated ${new Date().toLocaleDateString()}
      </div>
    </div>
    <table>
      <tr><td>Opening balance</td><td>$${statement.opening_balance.toFixed(2)}</td></tr>
    </table>
    <h3 style="margin-top:20px;">Charges this period</h3>
    <table>
      <thead><tr><th>Date</th><th>Passenger</th><th>Flight</th><th>Department</th><th>Amount</th></tr></thead>
      <tbody>${chargeRows || '<tr><td colspan="5">No charges this period.</td></tr>'}</tbody>
    </table>
    <h3 style="margin-top:20px;">Payments received this period</h3>
    <table>
      <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
      <tbody>${paymentRows || '<tr><td colspan="4">No payments recorded this period.</td></tr>'}</tbody>
    </table>
    <table style="margin-top:20px;">
      <tr><td>Opening balance</td><td>$${statement.opening_balance.toFixed(2)}</td></tr>
      <tr><td>Charges this period</td><td>+$${statement.total_charges.toFixed(2)}</td></tr>
      <tr><td>Payments this period</td><td>-$${statement.total_payments.toFixed(2)}</td></tr>
      <tr class="total-row"><td>Closing balance (amount due)</td><td>$${statement.closing_balance.toFixed(2)}</td></tr>
    </table>
  `;
  openPrintableDocument(`Statement — ${payerLabel}`, html);
}

// fixedPayer = { payer_type, payer_id, label } for self-service views (agent/corporate own
// account, no picker needed). Otherwise pass tenantOptions/corporateOptions to let an admin or
// cashier pick which account's statement to generate.
export default function StatementView({ fixedPayer, tenantOptions = [], corporateOptions = [] }) {
  const [payerType, setPayerType] = useState(fixedPayer?.payer_type || 'corporate_account');
  const [payerId, setPayerId] = useState(fixedPayer?.payer_id || '');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const payerLabel = fixedPayer?.label
    || (payerType === 'corporate_account' ? corporateOptions.find(c => c.id === payerId)?.name : tenantOptions.find(t => t.id === payerId)?.name)
    || '';

  async function generate() {
    if (!payerId) { setError('Select an account first'); return; }
    setError('');
    setLoading(true);
    try {
      const data = await api.getStatement({ payer_type: payerType, payer_id: payerId, from, to });
      setStatement(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>Statement of account</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Opening balance, charges, and payments for a billing period — the document a corporate
        account or travel agent uses to reconcile and pay.
      </p>

      <div className="grid grid-4 no-print" style={{ alignItems: 'end' }}>
        {!fixedPayer && (
          <>
            <div>
              <label>Account type</label>
              <select value={payerType} onChange={(e) => { setPayerType(e.target.value); setPayerId(''); setStatement(null); }}>
                <option value="corporate_account">Corporate account</option>
                <option value="tenant">Travel agent</option>
              </select>
            </div>
            <div>
              <label>Account</label>
              <select value={payerId} onChange={(e) => { setPayerId(e.target.value); setStatement(null); }}>
                <option value="">Select...</option>
                {(payerType === 'corporate_account' ? corporateOptions : tenantOptions).map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          </>
        )}
        <div>
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button onClick={generate} disabled={loading}>{loading ? 'Generating...' : 'Generate statement'}</button>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {statement && (
        <div style={{ marginTop: 16 }}>
          <div className="toolbar no-print">
            <button className="secondary" onClick={() => printStatement(statement, payerLabel)}>Print statement</button>
          </div>

          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            <div className="stat-card">
              <div className="stat-value">${statement.opening_balance.toFixed(2)}</div>
              <div className="stat-label">Opening balance</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">${statement.total_charges.toFixed(2)}</div>
              <div className="stat-label">Charges this period</div>
            </div>
            <div className={`stat-card ${statement.closing_balance > 0 ? 'stat-alert' : ''}`}>
              <div className="stat-value">${statement.closing_balance.toFixed(2)}</div>
              <div className="stat-label">Closing balance (amount due)</div>
            </div>
          </div>

          <h3>Charges this period</h3>
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>Date</th><th>Passenger</th><th>Flight</th><th>Department</th><th>Amount</th></tr></thead>
            <tbody>
              {statement.charges.map(c => (
                <tr key={c.id}>
                  <td>{new Date(c.visit_datetime).toLocaleDateString()}</td>
                  <td>{c.full_name}</td><td>{c.flight_number}</td><td>{c.department || '—'}</td>
                  <td>${Number(c.client_charge).toFixed(2)}</td>
                </tr>
              ))}
              {statement.charges.length === 0 && <tr><td colSpan={5}>No charges this period.</td></tr>}
            </tbody>
          </table>

          <h3>Payments received this period</h3>
          <table>
            <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
            <tbody>
              {statement.payments.map(p => (
                <tr key={p.id}>
                  <td>{new Date(p.payment_date).toLocaleDateString()}</td>
                  <td>{p.payment_method}</td><td>{p.reference_number || '—'}</td>
                  <td>${Number(p.amount).toFixed(2)}</td>
                </tr>
              ))}
              {statement.payments.length === 0 && <tr><td colSpan={4}>No payments recorded this period.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

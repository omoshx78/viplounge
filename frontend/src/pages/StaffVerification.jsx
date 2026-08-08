import { useEffect, useState, useCallback } from 'react';
import { api, printReceipt } from '../api/client';

// Shown after verifying an individual (cash/card) passenger — a distinct, explicit step from
// verification itself: staff confirms identity first, THEN separately collects payment and
// records a reference. Corporate passengers skip this entirely (billed later).
function PaymentCollectionPanel({ visit, onCollected, onDismiss }) {
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [collected, setCollected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function confirmPaid(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const result = await api.collectPayment(visit.id, { reference, notes });
      setCollected(true);
      onCollected({ ...visit, ...result });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ borderLeft: '4px solid var(--success)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span className="badge badge-success" style={{ marginBottom: 8 }}>Verified</span>
          <h2 style={{ margin: '4px 0' }}>{visit.full_name}</h2>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
            {visit.payment_type === 'cash' ? 'Cash' : 'Card'} payment
          </p>
        </div>
        <div className="stat-value" style={{ color: 'var(--success)' }}>
          ${Number(visit.client_charge).toFixed(2)}
        </div>
      </div>

      {!collected ? (
        <form onSubmit={confirmPaid} style={{ marginTop: 14 }}>
          <label>Payment reference (transaction ID, card auth code — optional for cash)</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={visit.payment_type === 'cash' ? 'e.g. till slip number' : 'e.g. card auth code'} />
          <label>Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button type="submit" disabled={saving}>{saving ? 'Confirming...' : 'Confirm payment collected'}</button>
        </form>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div className="badge badge-success" style={{ marginBottom: 10 }}>Payment collected — recorded for the cashier</div>
          <div>
            <button onClick={() => printReceipt(visit)}>Print receipt</button>{' '}
            <button className="secondary" onClick={onDismiss}>Done, next passenger</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StaffVerification() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [pendingPayment, setPendingPayment] = useState(null); // the just-verified individual visit, awaiting collection

  const load = useCallback(async () => {
    const data = await api.staffQueue();
    setQueue(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000); // live-ish queue refresh
    return () => clearInterval(interval);
  }, [load]);

  async function verify(queueItem) {
    setBusyId(queueItem.id);
    try {
      const result = await api.staffVerify(queueItem.id);
      const merged = { ...queueItem, ...result };
      if (!merged.corporate_account_name) {
        // Individual/cash-or-card pax: identity is confirmed, but payment collection is a
        // deliberately separate next step, not assumed automatic.
        setPendingPayment(merged);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id) {
    setBusyId(id);
    try { await api.staffReject(id); await load(); }
    finally { setBusyId(null); }
  }

  return (
    <div className="app-shell">
      <h1>Verification queue</h1>
      <p style={{ color: 'var(--text-muted)' }}>Match each entry against the passenger's physical passport and boarding pass before approving.</p>

      {pendingPayment && (
        <PaymentCollectionPanel
          visit={pendingPayment}
          onCollected={(updated) => setPendingPayment(updated)}
          onDismiss={() => setPendingPayment(null)}
        />
      )}

      {loading ? <p>Loading...</p> : queue.length === 0 ? (
        <div className="card">No pending check-ins right now.</div>
      ) : (
        queue.map((v) => (
          <div className="card" key={v.id}>
            <div className="grid grid-3">
              <div><strong>{v.full_name}</strong><br /><span style={{ color: 'var(--text-muted)' }}>{v.passport_number} · {v.nationality || '—'}</span></div>
              <div>Flight {v.flight_number} · {v.direction}</div>
              <div>{v.corporate_account_name ? `Corporate: ${v.corporate_account_name}` : `Individual · ${v.payment_type}`}</div>
            </div>
            {v.corporate_account_name && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Staff/Consultant ID: {v.staff_consultant_id || '—'} · Dept: {v.department || '—'} · Branch/Project: {v.branch_project || '—'} · Ref: {v.reference_number || '—'}
              </p>
            )}
            {!v.corporate_account_name && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Payment: {v.payment_type === 'cash' ? 'Cash' : 'Card'} — verify first, then you'll collect payment as a separate step.
              </p>
            )}
            {(v.passport_image_data || v.staff_id_image_data) && (
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                {v.passport_image_data && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Passport/ID photo</div>
                    <img src={v.passport_image_data} alt="Passport" style={{ height: 90, borderRadius: 6, border: '1px solid var(--border)' }} />
                  </div>
                )}
                {v.staff_id_image_data && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Staff ID photo</div>
                    <img src={v.staff_id_image_data} alt="Staff ID" style={{ height: 90, borderRadius: 6, border: '1px solid var(--border)' }} />
                  </div>
                )}
              </div>
            )}
            {!v.passport_image_data && !v.staff_id_image_data && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No document photo uploaded — verify against physical documents only.</p>
            )}
            <div style={{ marginTop: 10 }}>
              <button disabled={busyId === v.id} onClick={() => verify(v)}>Verify & approve</button>{' '}
              <button className="danger" disabled={busyId === v.id} onClick={() => reject(v.id)}>Reject</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';

export default function StaffVerification() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

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

  async function verify(id) {
    setBusyId(id);
    try { await api.staffVerify(id); await load(); }
    finally { setBusyId(null); }
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
              <button disabled={busyId === v.id} onClick={() => verify(v.id)}>Verify & approve</button>{' '}
              <button className="danger" disabled={busyId === v.id} onClick={() => reject(v.id)}>Reject</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

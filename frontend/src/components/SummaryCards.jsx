import { useEffect, useState, useCallback } from 'react';
import { api, getCurrentUser } from '../api/client';

export default function SummaryCards() {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingCount, setPendingCount] = useState(null);
  const user = getCurrentUser();
  const isLoungeStaffOrAdmin = user?.role === 'lounge_admin' || user?.role === 'lounge_staff';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.summary({});
      setS(data);
      if (isLoungeStaffOrAdmin) {
        const queue = await api.staffQueue();
        setPendingCount(queue.length);
      }
    } catch (err) {
      setError(err.message || 'Could not load metrics');
    } finally {
      setLoading(false);
    }
  }, [isLoungeStaffOrAdmin]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>Loading metrics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <p style={{ color: 'var(--danger)', marginBottom: 10 }}>Couldn't load metrics: {error}</p>
        <button className="secondary" onClick={load}>Retry</button>
      </div>
    );
  }

  if (!s) return null;

  const cards = [
    { label: 'Total visits', value: s.total_visits },
    { label: 'Arrivals / departures', value: `${s.arrivals} / ${s.departures}` },
    { label: 'Corporate visits', value: s.corporate_visits },
    { label: 'Individual visits', value: s.individual_visits },
    { label: 'Corporate revenue', value: `$${Number(s.corporate_revenue).toFixed(2)}` },
    { label: 'Individual revenue', value: `$${Number(s.individual_revenue).toFixed(2)}` },
  ];

  // Pending verification queue is only meaningful (and only permitted) for lounge staff/admin —
  // a travel agent or corporate account shouldn't see other people's unverified check-ins.
  if (isLoungeStaffOrAdmin && pendingCount !== null) {
    cards.unshift({ label: 'Awaiting verification', value: pendingCount });
  }

  return (
    <div className="grid grid-3" style={{ marginBottom: 20 }}>
      {cards.map((c) => (
        <div className="stat-card" key={c.label}>
          <div className="stat-value">{c.value}</div>
          <div className="stat-label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

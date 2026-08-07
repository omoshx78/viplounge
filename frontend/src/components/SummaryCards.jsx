import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function SummaryCards() {
  const [s, setS] = useState(null);

  useEffect(() => { api.summary({}).then(setS); }, []);
  if (!s) return null;

  const cards = [
    { label: 'Total visits', value: s.total_visits },
    { label: 'Arrivals / departures', value: `${s.arrivals} / ${s.departures}` },
    { label: 'Corporate visits', value: s.corporate_visits },
    { label: 'Individual visits', value: s.individual_visits },
    { label: 'Corporate revenue', value: `$${Number(s.corporate_revenue).toFixed(2)}` },
    { label: 'Individual revenue', value: `$${Number(s.individual_revenue).toFixed(2)}` },
  ];

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

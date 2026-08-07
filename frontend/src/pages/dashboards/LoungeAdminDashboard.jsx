import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import SummaryCards from '../../components/SummaryCards';
import VisitsTable from '../../components/VisitsTable';

function PlatformSubscriptionPanel() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ billing_model: 'per_pax', rate_per_pax: '', flat_monthly_amount: '' });
  const [saving, setSaving] = useState(false);

  const load = () => api.getPlatformSubscription().then(setData);
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updatePlatformSubscription({
        billing_model: form.billing_model,
        rate_per_pax: form.billing_model === 'per_pax' ? Number(form.rate_per_pax) : null,
        flat_monthly_amount: form.billing_model === 'flat_monthly' ? Number(form.flat_monthly_amount) : null,
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card no-print">
      <h2>Platform subscription — amount due to system provider</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Visible only here. Never shown to travel agents or corporate accounts.
      </p>
      {data && (
        <div className="stat-card" style={{ marginBottom: 16, maxWidth: 260 }}>
          <div className="stat-value">${Number(data.total_outstanding).toFixed(2)}</div>
          <div className="stat-label">Total outstanding</div>
        </div>
      )}
      {data?.current_plan && (
        <p style={{ fontSize: 13 }}>
          Current plan: <strong>{data.current_plan.billing_model === 'per_pax' ? `$${data.current_plan.rate_per_pax} per verified visit` : `$${data.current_plan.flat_monthly_amount} flat / month`}</strong>
        </p>
      )}
      <form onSubmit={save} className="grid grid-3" style={{ alignItems: 'end' }}>
        <div>
          <label>Billing model</label>
          <select value={form.billing_model} onChange={(e) => setForm(f => ({ ...f, billing_model: e.target.value }))}>
            <option value="per_pax">Per pax (per visit)</option>
            <option value="flat_monthly">Flat monthly rate</option>
          </select>
        </div>
        {form.billing_model === 'per_pax' ? (
          <div>
            <label>Rate per visit ($)</label>
            <input type="number" step="0.01" value={form.rate_per_pax} onChange={(e) => setForm(f => ({ ...f, rate_per_pax: e.target.value }))} />
          </div>
        ) : (
          <div>
            <label>Flat monthly amount ($)</label>
            <input type="number" step="0.01" value={form.flat_monthly_amount} onChange={(e) => setForm(f => ({ ...f, flat_monthly_amount: e.target.value }))} />
          </div>
        )}
        <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Update plan'}</button>
      </form>
    </div>
  );
}

function RateCardsPanel() {
  const [rateCards, setRateCards] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [corporateAccounts, setCorporateAccounts] = useState([]);
  const [form, setForm] = useState({ scope_type: 'global', scope_id: '', lounge_rate: '', markup_type: 'flat', markup_value: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.listRateCards().then(setRateCards);
    api.listTenants().then(setTenants);
    api.listCorporateAccounts().then(setCorporateAccounts);
  };
  useEffect(load, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createRateCard({
        ...form,
        scope_id: form.scope_type === 'global' ? null : form.scope_id,
        lounge_rate: Number(form.lounge_rate),
        markup_value: Number(form.markup_value || 0),
      });
      setForm({ scope_type: 'global', scope_id: '', lounge_rate: '', markup_type: 'flat', markup_value: '' });
      load();
    } finally {
      setSaving(false);
    }
  }

  const scopeOptions = form.scope_type === 'tenant' ? tenants : form.scope_type === 'corporate_account' ? corporateAccounts : [];

  return (
    <div className="card no-print">
      <h2>Rate cards</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Managed by the lounge only, per agreed contracts. Editing creates a new versioned rate — past visits keep the rate that applied at the time.
      </p>
      <table style={{ marginBottom: 16 }}>
        <thead><tr><th>Scope</th><th>Lounge rate</th><th>Markup</th></tr></thead>
        <tbody>
          {rateCards.map(rc => (
            <tr key={rc.id}>
              <td>{rc.scope_type} — {rc.scope_name}</td>
              <td>${Number(rc.lounge_rate).toFixed(2)}</td>
              <td>{rc.markup_type === 'percentage' ? `${rc.markup_value}%` : `$${Number(rc.markup_value).toFixed(2)} flat`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={save} className="grid grid-4" style={{ alignItems: 'end' }}>
        <div>
          <label>Scope</label>
          <select value={form.scope_type} onChange={(e) => setForm(f => ({ ...f, scope_type: e.target.value, scope_id: '' }))}>
            <option value="global">Global default</option>
            <option value="tenant">Travel agent</option>
            <option value="corporate_account">Corporate account</option>
          </select>
        </div>
        {form.scope_type !== 'global' && (
          <div>
            <label>{form.scope_type === 'tenant' ? 'Travel agent' : 'Corporate account'}</label>
            <select required value={form.scope_id} onChange={(e) => setForm(f => ({ ...f, scope_id: e.target.value }))}>
              <option value="">Select...</option>
              {scopeOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label>Lounge rate ($)</label>
          <input required type="number" step="0.01" value={form.lounge_rate} onChange={(e) => setForm(f => ({ ...f, lounge_rate: e.target.value }))} />
        </div>
        <div>
          <label>Markup type</label>
          <select value={form.markup_type} onChange={(e) => setForm(f => ({ ...f, markup_type: e.target.value }))}>
            <option value="flat">Flat ($)</option>
            <option value="percentage">Percentage (%)</option>
          </select>
        </div>
        <div>
          <label>Markup value</label>
          <input type="number" step="0.01" value={form.markup_value} onChange={(e) => setForm(f => ({ ...f, markup_value: e.target.value }))} />
        </div>
        <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save rate card'}</button>
      </form>
    </div>
  );
}

export default function LoungeAdminDashboard() {
  const [tenants, setTenants] = useState([]);
  const [corporateOptions, setCorporateOptions] = useState([]);

  useEffect(() => {
    api.listTenants().then(setTenants);
    api.listCorporateAccounts().then(setCorporateOptions);
  }, []);

  return (
    <div className="app-shell">
      <h1>Lounge management dashboard</h1>
      <SummaryCards />
      <RateCardsPanel />
      <PlatformSubscriptionPanel />
      <div className="card">
        <h2>All traffic</h2>
        <VisitsTable showTenantFilter showCorporateFilter tenantOptions={tenants} corporateOptions={corporateOptions} />
      </div>
    </div>
  );
}

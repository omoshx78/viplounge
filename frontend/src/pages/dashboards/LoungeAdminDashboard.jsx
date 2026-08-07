import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, openPrintableDocument } from '../../api/client';
import SummaryCards from '../../components/SummaryCards';
import VisitsTable from '../../components/VisitsTable';
import StatementView from '../../components/StatementView';

const LOUNGE_NAME = 'Juba International Airport VIP Lounge';

function printList(title, headers, rows) {
  const rowsHtml = rows.map(r => `<tr>${r.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
  const html = `
    <div class="doc-header">
      <div><div class="eyebrow">${title}</div><h1>${LOUNGE_NAME}</h1></div>
      <div class="doc-meta">Generated ${new Date().toLocaleString()}<br />${rows.length} record${rows.length === 1 ? '' : 's'}</div>
    </div>
    <table>
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
  openPrintableDocument(title, html);
}

function PlatformSubscriptionPanel() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ billing_model: 'per_pax', rate_per_pax: '', flat_monthly_amount: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoadError('');
    api.getPlatformSubscription().then(setData).catch((err) => setLoadError(err.message));
  };
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
      {loadError && (
        <p style={{ color: 'var(--danger)' }}>
          Couldn't load this: {loadError} <button className="secondary" onClick={load}>Retry</button>
        </p>
      )}
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
      <form onSubmit={save} className="grid grid-3 no-print" style={{ alignItems: 'end' }}>
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
  const [loadError, setLoadError] = useState('');

  const load = () => {
    setLoadError('');
    Promise.all([api.listRateCards(), api.listTenants(), api.listCorporateAccounts()])
      .then(([rc, t, c]) => { setRateCards(rc); setTenants(t); setCorporateAccounts(c); })
      .catch((err) => setLoadError(err.message));
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
      {loadError && (
        <p style={{ color: 'var(--danger)' }}>
          Couldn't load this: {loadError} <button className="secondary" onClick={load}>Retry</button>
        </p>
      )}
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

      <form onSubmit={save} className="grid grid-4 no-print" style={{ alignItems: 'end' }}>
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

function TenantsAndCorporatePanel({ onChange }) {
  const [tenants, setTenants] = useState([]);
  const [corporateAccounts, setCorporateAccounts] = useState([]);
  const [tenantForm, setTenantForm] = useState({ name: '', contact_email: '', contact_phone: '' });
  const [corpForm, setCorpForm] = useState({ name: '', tenant_id: '', billing_contact_name: '', billing_contact_email: '', report_cadence: 'monthly' });
  const [savingTenant, setSavingTenant] = useState(false);
  const [savingCorp, setSavingCorp] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = () => {
    setLoadError('');
    Promise.all([api.listTenants(), api.listCorporateAccounts()])
      .then(([t, c]) => { setTenants(t); setCorporateAccounts(c); })
      .catch((err) => setLoadError(err.message));
  };
  useEffect(load, []);

  async function saveTenant(e) {
    e.preventDefault();
    setSavingTenant(true);
    try {
      await api.createTenant(tenantForm);
      setTenantForm({ name: '', contact_email: '', contact_phone: '' });
      load();
      onChange?.();
    } finally {
      setSavingTenant(false);
    }
  }

  async function saveCorp(e) {
    e.preventDefault();
    setSavingCorp(true);
    try {
      await api.createCorporateAccount({ ...corpForm, tenant_id: corpForm.tenant_id || null });
      setCorpForm({ name: '', tenant_id: '', billing_contact_name: '', billing_contact_email: '', report_cadence: 'monthly' });
      load();
      onChange?.();
    } finally {
      setSavingCorp(false);
    }
  }

  return (
    <div className="card no-print">
      <h2>Travel agents & corporate accounts</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Add real companies here before going live. New corporate accounts appear immediately in the
        passenger check-in dropdown and in the rate card panel below.
      </p>
      {loadError && (
        <p style={{ color: 'var(--danger)' }}>
          Couldn't load this: {loadError} <button className="secondary" onClick={load}>Retry</button>
        </p>
      )}

      <div className="grid grid-2">
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Existing travel agents</h3>
            <button className="secondary no-print" style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => printList('Travel agents', ['Name', 'Contact'], tenants.map(t => [t.name, t.contact_email || '—']))}>
              Print
            </button>
          </div>
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>Name</th><th>Contact</th></tr></thead>
            <tbody>
              {tenants.map(t => <tr key={t.id}><td>{t.name}</td><td>{t.contact_email || '—'}</td></tr>)}
              {tenants.length === 0 && <tr><td colSpan={2}>None yet.</td></tr>}
            </tbody>
          </table>
          <form onSubmit={saveTenant} className="no-print">
            <label>New travel agent name</label>
            <input required value={tenantForm.name} onChange={(e) => setTenantForm(f => ({ ...f, name: e.target.value }))} />
            <label>Contact email</label>
            <input type="email" value={tenantForm.contact_email} onChange={(e) => setTenantForm(f => ({ ...f, contact_email: e.target.value }))} />
            <label>Contact phone</label>
            <input value={tenantForm.contact_phone} onChange={(e) => setTenantForm(f => ({ ...f, contact_phone: e.target.value }))} />
            <button type="submit" disabled={savingTenant}>{savingTenant ? 'Adding...' : 'Add travel agent'}</button>
          </form>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Existing corporate accounts</h3>
            <button className="secondary no-print" style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => printList('Travel agents & corporate clients', ['Name', 'Travel agent'], corporateAccounts.map(c => [c.name, c.tenant_name || 'Direct (no agent)']))}>
              Print
            </button>
          </div>
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>Name</th><th>Travel agent</th></tr></thead>
            <tbody>
              {corporateAccounts.map(c => <tr key={c.id}><td>{c.name}</td><td>{c.tenant_name || 'Direct (no agent)'}</td></tr>)}
              {corporateAccounts.length === 0 && <tr><td colSpan={2}>None yet.</td></tr>}
            </tbody>
          </table>
          <form onSubmit={saveCorp} className="no-print">
            <label>New corporate account name</label>
            <input required value={corpForm.name} onChange={(e) => setCorpForm(f => ({ ...f, name: e.target.value }))} />
            <label>Travel agent (leave blank if this company books directly)</label>
            <select value={corpForm.tenant_id} onChange={(e) => setCorpForm(f => ({ ...f, tenant_id: e.target.value }))}>
              <option value="">Direct — no travel agent</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <label>Billing contact name</label>
            <input value={corpForm.billing_contact_name} onChange={(e) => setCorpForm(f => ({ ...f, billing_contact_name: e.target.value }))} />
            <label>Billing contact email</label>
            <input type="email" value={corpForm.billing_contact_email} onChange={(e) => setCorpForm(f => ({ ...f, billing_contact_email: e.target.value }))} />
            <label>Report cadence</label>
            <select value={corpForm.report_cadence} onChange={(e) => setCorpForm(f => ({ ...f, report_cadence: e.target.value }))}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <button type="submit" disabled={savingCorp}>{savingCorp ? 'Adding...' : 'Add corporate account'}</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function UsersPanel({ tenants, corporateAccounts }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'lounge_staff', tenant_id: '', corporate_account_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resetLink, setResetLink] = useState(null);
  const [generatingFor, setGeneratingFor] = useState(null);
  const [loadError, setLoadError] = useState('');

  const load = () => {
    setLoadError('');
    api.listUsers().then(setUsers).catch((err) => setLoadError(err.message));
  };
  useEffect(load, []);

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.createUser(form);
      setForm({ email: '', password: '', full_name: '', role: 'lounge_staff', tenant_id: '', corporate_account_id: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function generateReset(userId) {
    setGeneratingFor(userId);
    try {
      const result = await api.generateResetLink(userId);
      setResetLink(result);
    } finally {
      setGeneratingFor(null);
    }
  }

  return (
    <div className="card no-print">
      <h2>Logins</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Create the actual login a travel agent or corporate account uses to see their own scoped
        reports. Once someone has a login, they can change their own password any time from the
        "Change password" link in their nav bar — you only need to set the first one, or generate
        a reset link below if they forget it.
      </p>
      {loadError && (
        <p style={{ color: 'var(--danger)' }}>
          Couldn't load this: {loadError} <button className="secondary" onClick={load}>Retry</button>
        </p>
      )}

      {resetLink && (
        <div className="card" style={{ background: 'var(--bg)', marginBottom: 16 }}>
          <p style={{ fontSize: 13, marginBottom: 6 }}>
            One-time reset link for <strong>{resetLink.for_email}</strong> — share this with them
            directly (email, WhatsApp, etc.). It expires in 24 hours or after first use, and you
            will not see the password they choose.
          </p>
          <input readOnly value={resetLink.reset_link} onClick={(e) => e.target.select()} style={{ marginBottom: 8 }} />
          <button className="secondary" onClick={() => setResetLink(null)}>Dismiss</button>
        </div>
      )}

      <div className="toolbar no-print" style={{ marginTop: 0 }}>
        <button className="secondary"
          onClick={() => printList('Staff & partner logins', ['Name', 'Email', 'Role', 'Linked to'], users.map(u => [u.full_name, u.email, u.role, u.tenant_name || u.corporate_account_name || '—']))}>
          Print
        </button>
      </div>

      <table style={{ marginBottom: 16 }}>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Linked to</th><th></th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>{u.full_name}</td><td>{u.email}</td><td>{u.role}</td>
              <td>{u.tenant_name || u.corporate_account_name || '—'}</td>
              <td>
                <button className="secondary" disabled={generatingFor === u.id} onClick={() => generateReset(u.id)}>
                  {generatingFor === u.id ? 'Generating...' : 'Generate reset link'}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && <tr><td colSpan={5}>None yet.</td></tr>}
        </tbody>
      </table>

      <form onSubmit={save} className="grid grid-3 no-print" style={{ alignItems: 'end' }}>
        <div>
          <label>Full name</label>
          <input required value={form.full_name} onChange={(e) => setForm(f => ({ ...f, full_name: e.target.value }))} />
        </div>
        <div>
          <label>Email</label>
          <input required type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} />
        </div>
        <div>
          <label>Password</label>
          <input required type="text" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Set an initial password" />
        </div>
        <div>
          <label>Role</label>
          <select value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value, tenant_id: '', corporate_account_id: '' }))}>
            <option value="lounge_staff">Lounge staff</option>
            <option value="lounge_admin">Lounge admin</option>
            <option value="cashier">Cashier</option>
            <option value="travel_agent">Travel agent</option>
            <option value="corporate_admin">Corporate admin</option>
          </select>
        </div>
        {form.role === 'travel_agent' && (
          <div>
            <label>Travel agent company</label>
            <select required value={form.tenant_id} onChange={(e) => setForm(f => ({ ...f, tenant_id: e.target.value }))}>
              <option value="">Select...</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {form.role === 'corporate_admin' && (
          <div>
            <label>Corporate account</label>
            <select required value={form.corporate_account_id} onChange={(e) => setForm(f => ({ ...f, corporate_account_id: e.target.value }))}>
              <option value="">Select...</option>
              {corporateAccounts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create login'}</button>
      </form>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}

const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'companies', label: 'Travel agents & corporates' },
  { key: 'logins', label: 'Logins' },
  { key: 'rate-cards', label: 'Rate cards' },
  { key: 'statements', label: 'Statements & payments' },
  { key: 'subscription', label: 'Platform subscription' },
  { key: 'traffic', label: 'Passengers' },
];

export default function LoungeAdminDashboard() {
  const [tenants, setTenants] = useState([]);
  const [corporateOptions, setCorporateOptions] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [optionsError, setOptionsError] = useState('');
  const [section, setSection] = useState('overview');
  const navigate = useNavigate();

  const loadOptions = () => {
    setOptionsError('');
    Promise.all([api.listTenants(), api.listCorporateAccounts()])
      .then(([t, c]) => { setTenants(t); setCorporateOptions(c); })
      .catch((err) => setOptionsError(err.message));
  };

  useEffect(loadOptions, [refreshKey]);

  // Awaiting verification and low stock are separate routes (their own dedicated pages);
  // every other overview metric is really just "the passenger list, filtered" — so it jumps
  // to the All passengers section right here rather than leaving the dashboard.
  function handleOverviewCardClick(key) {
    if (key === 'pending') navigate('/staff');
    else if (key === 'lowstock') navigate('/inventory');
    else setSection('traffic');
  }

  return (
    <div className="app-shell">
      <h1>Lounge management dashboard</h1>

      <div className="sidebar-layout">
        <div className="sidebar-menu no-print">
          <div className="card" style={{ padding: 8 }}>
            {SECTIONS.map(s => (
              <div
                key={s.key}
                className={`sidebar-menu-item ${section === s.key ? 'active' : ''}`}
                onClick={() => setSection(s.key)}
              >
                {s.label}
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-content">
          {section === 'overview' && <SummaryCards onCardClick={handleOverviewCardClick} />}
          {section === 'companies' && <TenantsAndCorporatePanel onChange={() => setRefreshKey(k => k + 1)} />}
          {section === 'logins' && <UsersPanel tenants={tenants} corporateAccounts={corporateOptions} />}
          {section === 'rate-cards' && <RateCardsPanel key={refreshKey} />}
          {section === 'statements' && (
            <>
              <div className="card no-print" style={{ marginBottom: 0 }}>
                <p style={{ margin: 0, fontSize: 13 }}>
                  To record a payment received, use the <button className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => navigate('/cashier')}>Cashier page</button> — statements here reflect payments posted there.
                </p>
              </div>
              <StatementView tenantOptions={tenants} corporateOptions={corporateOptions} />
            </>
          )}
          {section === 'subscription' && <PlatformSubscriptionPanel />}
          {section === 'traffic' && (
            <div className="card">
              <h2>Passengers</h2>
              {optionsError && (
                <p style={{ color: 'var(--danger)' }}>
                  Couldn't load filter options: {optionsError} <button className="secondary" onClick={loadOptions}>Retry</button>
                </p>
              )}
              <VisitsTable showTenantFilter showCorporateFilter tenantOptions={tenants} corporateOptions={corporateOptions} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

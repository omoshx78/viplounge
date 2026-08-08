import { useEffect, useState, useCallback } from 'react';
import { api, downloadCsv, openPrintableDocument, printReceipt } from '../api/client';

const LOUNGE_NAME = 'Juba International Airport VIP Lounge';

// Stable references for default props — a fresh {} or [] literal as a default parameter value
// is a NEW object every single render, which (since these flow into a useCallback dependency
// array below) was causing an infinite render loop: new object -> new `load` identity -> effect
// re-fires -> state update -> re-render -> new object again. That loop is what made the
// passenger list get stuck on "Loading..." forever, especially wherever fixedFilters wasn't
// explicitly passed at all (e.g. the main Passengers list).
const EMPTY_FILTERS = {};
const EMPTY_OPTIONS = [];

function printInvoice(rows, scopeLabel, hasBreakdown) {
  const total = rows.reduce((sum, r) => sum + Number(r.client_charge), 0);
  const rowsHtml = rows.map(r => `
    <tr>
      <td>${new Date(r.visit_datetime).toLocaleDateString()}</td>
      <td>${r.full_name}</td>
      <td>${r.flight_number}</td>
      <td>${r.department || '—'}</td>
      <td>$${Number(r.client_charge).toFixed(2)}</td>
    </tr>
  `).join('');
  const html = `
    <div class="doc-header">
      <div>
        <div class="eyebrow">Invoice</div>
        <h1>${LOUNGE_NAME}</h1>
      </div>
      <div class="doc-meta">
        Billed to: ${scopeLabel}<br />
        Generated ${new Date().toLocaleDateString()}<br />
        ${rows.length} visit${rows.length === 1 ? '' : 's'}
      </div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Passenger</th><th>Flight</th><th>Department</th><th>Amount</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <table>
      <tr class="total-row"><td>Total due</td><td>$${total.toFixed(2)}</td></tr>
    </table>
    ${hasBreakdown ? '<p style="color:#6b6558;font-size:12px;">Internal copy — includes cost/markup breakdown not shown to the billed party.</p>' : ''}
  `;
  openPrintableDocument(`Invoice — ${scopeLabel}`, html);
}

// Opens on clicking a row — fetches the full record lazily (including passport/staff-ID
// photos, if still within their 30-day retention window) rather than loading images for every
// row in the list up front.
function PassengerDetailModal({ visitId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getVisitDetail(visitId)
      .then(setDetail)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [visitId]);

  const hasBreakdown = detail && detail.lounge_cost !== null && detail.lounge_cost !== undefined;

  return (
    <div className="modal-overlay no-print" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        {loading && <p>Loading passenger details...</p>}
        {error && <p style={{ color: 'var(--danger)' }}>Couldn't load details: {error}</p>}

        {detail && (
          <>
            <h2 style={{ marginTop: 0 }}>{detail.full_name}</h2>
            <p style={{ color: 'var(--text-muted)', marginTop: -8, fontSize: 13 }}>
              {detail.passport_number} · {detail.nationality || 'Nationality not recorded'}
            </p>

            <div className="grid grid-2" style={{ marginBottom: 16 }}>
              <div>
                <div className="inventory-category-label">Visit</div>
                <p style={{ margin: '2px 0', fontSize: 14 }}>Flight {detail.flight_number} · {detail.direction}</p>
                <p style={{ margin: '2px 0', fontSize: 14 }}>{new Date(detail.visit_datetime).toLocaleString()}</p>
                <p style={{ margin: '2px 0', fontSize: 14 }}>
                  <span className={`badge ${detail.status === 'verified' ? 'badge-success' : detail.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>{detail.status}</span>
                </p>
              </div>
              <div>
                <div className="inventory-category-label">{detail.corporate_account_name ? 'Corporate' : 'Individual'}</div>
                {detail.corporate_account_name ? (
                  <>
                    <p style={{ margin: '2px 0', fontSize: 14 }}>{detail.corporate_account_name}{detail.tenant_name ? ` (via ${detail.tenant_name})` : ''}</p>
                    <p style={{ margin: '2px 0', fontSize: 14 }}>ID: {detail.staff_consultant_id || '—'} · Dept: {detail.department || '—'}</p>
                    <p style={{ margin: '2px 0', fontSize: 14 }}>Branch/Project: {detail.branch_project || '—'} · Ref: {detail.reference_number || '—'}</p>
                  </>
                ) : (
                  <>
                    <p style={{ margin: '2px 0', fontSize: 14 }}>Payment: {detail.payment_type}</p>
                    <p style={{ margin: '2px 0', fontSize: 14 }}>
                      {detail.payment_collected ? `Collected ${new Date(detail.payment_collected_at).toLocaleString()}` : 'Not yet collected'}
                    </p>
                    {detail.payment_reference && <p style={{ margin: '2px 0', fontSize: 14 }}>Ref: {detail.payment_reference}</p>}
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-3" style={{ marginBottom: 16 }}>
              {hasBreakdown && (
                <div className="stat-card">
                  <div className="stat-value">${Number(detail.lounge_cost).toFixed(2)}</div>
                  <div className="stat-label">Lounge cost</div>
                </div>
              )}
              {hasBreakdown && (
                <div className="stat-card">
                  <div className="stat-value">${Number(detail.agent_markup).toFixed(2)}</div>
                  <div className="stat-label">Agent markup</div>
                </div>
              )}
              <div className="stat-card">
                <div className="stat-value">${Number(detail.client_charge).toFixed(2)}</div>
                <div className="stat-label">Client charge</div>
              </div>
            </div>

            <div className="inventory-category-label">Documents on file</div>
            {(detail.passport_image_data || detail.staff_id_image_data) ? (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {detail.passport_image_data && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Passport / ID photo</div>
                    <img src={detail.passport_image_data} alt="Passport" style={{ maxHeight: 220, borderRadius: 8, border: '1px solid var(--border)' }} />
                  </div>
                )}
                {detail.staff_id_image_data && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Staff ID photo</div>
                    <img src={detail.staff_id_image_data} alt="Staff ID" style={{ maxHeight: 220, borderRadius: 8, border: '1px solid var(--border)' }} />
                  </div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                No photo on file — either none was uploaded at check-in, or it has passed its 30-day retention window and was automatically deleted.
              </p>
            )}

            {detail.status === 'verified' && (
              <div style={{ marginTop: 16 }}>
                <button onClick={() => printReceipt(detail)}>Print receipt</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


// used across the corporate, travel agent, and lounge admin dashboards. Each dashboard
// passes fixed filters (e.g. a corporate account locks corporate_account_id) plus whatever
// extra filter controls make sense for that role.
export default function VisitsTable({ fixedFilters = EMPTY_FILTERS, showTenantFilter, showCorporateFilter, tenantOptions = EMPTY_OPTIONS, corporateOptions = EMPTY_OPTIONS }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [sort, setSort] = useState('date');
  const [order, setOrder] = useState('desc');
  const [direction, setDirection] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [corporateAccountId, setCorporateAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedVisitId, setSelectedVisitId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api.listVisits({
        ...fixedFilters,
        search, sort, order, direction,
        payment_type: paymentType,
        tenant_id: tenantId, corporate_account_id: corporateAccountId,
        from, to,
      });
      setRows(data);
    } catch (err) {
      setLoadError(err.message || 'Could not load visits');
    } finally {
      setLoading(false);
    }
  }, [fixedFilters, search, sort, order, direction, paymentType, tenantId, corporateAccountId, from, to]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (search.length < 2) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      const s = await api.searchSuggest(search);
      setSuggestions(s);
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  function toggleSort(col) {
    if (sort === col) setOrder(order === 'asc' ? 'desc' : 'asc');
    else { setSort(col); setOrder('asc'); }
  }

  const hasBreakdown = rows.length > 0 && rows[0].lounge_cost !== null && rows[0].lounge_cost !== undefined;

  function handleExport() {
    // lounge_cost/agent_markup come back as null from the API for a corporate_admin viewer
    // (enforced server-side, not just hidden here) — so this conditionally includes those
    // columns only when the data actually contains them.
    downloadCsv(`lounge-passengers-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(r => ({
      Name: r.full_name, Passport: r.passport_number, Direction: r.direction, Flight: r.flight_number,
      Date: new Date(r.visit_datetime).toLocaleString(), Status: r.status,
      'Corporate account': r.corporate_account_name || '', 'Travel agent': r.tenant_name || '',
      'Staff/Consultant ID': r.staff_consultant_id || '', Department: r.department || '',
      'Branch/Project': r.branch_project || '', 'Payment type': r.payment_type,
      ...(hasBreakdown ? { 'Lounge cost': r.lounge_cost, 'Agent markup': r.agent_markup } : {}),
      'Client charge': r.client_charge,
    })));
  }

  // Invoice generation only makes sense once the list is scoped to exactly one payer — either
  // a single corporate account or a single travel agent — otherwise "the total" is meaningless.
  const invoiceScopeLabel = corporateAccountId
    ? corporateOptions.find(c => c.id === corporateAccountId)?.name
    : tenantId
      ? tenantOptions.find(t => t.id === tenantId)?.name
      : null;

  return (
    <div>
      <div className="toolbar no-print">
        <div className="autocomplete" style={{ minWidth: 220 }}>
          <input
            placeholder="Search name, passport, staff ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {suggestions.length > 0 && (
            <div className="autocomplete-list">
              {suggestions.map((s, i) => (
                <div key={i} onClick={() => { setSearch(s.full_name); setSuggestions([]); }}>
                  {s.full_name} — {s.passport_number}
                </div>
              ))}
            </div>
          )}
        </div>
        <select value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">All directions</option>
          <option value="arrival">Arrival</option>
          <option value="departure">Departure</option>
        </select>
        <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
          <option value="">All payment types</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="corporate">Corporate</option>
        </select>
        {showTenantFilter && (
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="">All travel agents</option>
            {tenantOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {showCorporateFilter && (
          <select value={corporateAccountId} onChange={(e) => setCorporateAccountId(e.target.value)}>
            <option value="">All corporate accounts</option>
            {corporateOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="secondary" onClick={handleExport}>Download CSV</button>
        <button className="secondary" onClick={() => window.print()}>Print list</button>
        {invoiceScopeLabel && rows.length > 0 && (
          <button onClick={() => printInvoice(rows, invoiceScopeLabel, hasBreakdown)}>Generate invoice</button>
        )}
      </div>

      {loading ? <p>Loading...</p> : loadError ? (
        <p style={{ color: 'var(--danger)' }}>
          Couldn't load visits: {loadError} <button className="secondary" onClick={load}>Retry</button>
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th onClick={() => toggleSort('name')}>Name {sort === 'name' && (order === 'asc' ? '↑' : '↓')}</th>
              <th>Passport</th>
              <th onClick={() => toggleSort('date')}>Date {sort === 'date' && (order === 'asc' ? '↑' : '↓')}</th>
              <th>Direction</th>
              <th onClick={() => toggleSort('flight')}>Flight {sort === 'flight' && (order === 'asc' ? '↑' : '↓')}</th>
              <th onClick={() => toggleSort('department')}>Department {sort === 'department' && (order === 'asc' ? '↑' : '↓')}</th>
              <th>Corporate account</th>
              <th>Status</th>
              <th onClick={() => toggleSort('amount')}>Charge {sort === 'amount' && (order === 'asc' ? '↑' : '↓')}</th>
              <th className="no-print">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="clickable-row" onClick={() => setSelectedVisitId(r.id)}>
                <td>{r.full_name}</td>
                <td>{r.passport_number}</td>
                <td>{new Date(r.visit_datetime).toLocaleString()}</td>
                <td>{r.direction}</td>
                <td>{r.flight_number}</td>
                <td>{r.department || '—'}</td>
                <td>{r.corporate_account_name || 'Individual'}</td>
                <td>
                  <span className={`badge ${r.status === 'verified' ? 'badge-success' : r.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                    {r.status}
                  </span>
                </td>
                <td>${Number(r.client_charge).toFixed(2)}</td>
                <td className="no-print">
                  {r.status === 'verified' && (
                    <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={(e) => { e.stopPropagation(); printReceipt(r); }}>Print</button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10}>No passengers match these filters.</td></tr>}
          </tbody>
        </table>
      )}

      {selectedVisitId && (
        <PassengerDetailModal visitId={selectedVisitId} onClose={() => setSelectedVisitId(null)} />
      )}
    </div>
  );
}

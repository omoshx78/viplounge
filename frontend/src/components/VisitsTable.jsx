import { useEffect, useState, useCallback } from 'react';
import { api, downloadCsv } from '../api/client';

// A visits list with type-ahead search, sortable columns, filters, and download/print —
// used across the corporate, travel agent, and lounge admin dashboards. Each dashboard
// passes fixed filters (e.g. a corporate account locks corporate_account_id) plus whatever
// extra filter controls make sense for that role.
export default function VisitsTable({ fixedFilters = {}, showTenantFilter, showCorporateFilter, tenantOptions = [], corporateOptions = [] }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [sort, setSort] = useState('date');
  const [order, setOrder] = useState('desc');
  const [direction, setDirection] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [corporateAccountId, setCorporateAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listVisits({
        ...fixedFilters,
        search, sort, order, direction,
        tenant_id: tenantId, corporate_account_id: corporateAccountId,
        from, to,
      });
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [fixedFilters, search, sort, order, direction, tenantId, corporateAccountId, from, to]);

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

  function handleExport() {
    downloadCsv(`lounge-visits-${new Date().toISOString().slice(0, 10)}.csv`, rows.map(r => ({
      Name: r.full_name, Passport: r.passport_number, Direction: r.direction, Flight: r.flight_number,
      Date: new Date(r.visit_datetime).toLocaleString(), Status: r.status,
      'Corporate account': r.corporate_account_name || '', 'Travel agent': r.tenant_name || '',
      'Staff/Consultant ID': r.staff_consultant_id || '', Department: r.department || '',
      'Branch/Project': r.branch_project || '', 'Payment type': r.payment_type,
      'Lounge cost': r.lounge_cost, 'Agent markup': r.agent_markup, 'Client charge': r.client_charge,
    })));
  }

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
        <button className="secondary" onClick={() => window.print()}>Print</button>
      </div>

      {loading ? <p>Loading...</p> : (
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
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
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
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9}>No visits match these filters.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

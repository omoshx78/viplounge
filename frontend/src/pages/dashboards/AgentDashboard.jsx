import { useEffect, useState } from 'react';
import { getCurrentUser, api } from '../../api/client';
import SummaryCards from '../../components/SummaryCards';
import VisitsTable from '../../components/VisitsTable';

export default function AgentDashboard() {
  const user = getCurrentUser();
  const [corporateOptions, setCorporateOptions] = useState([]);

  useEffect(() => {
    // Note: this uses the admin listing for simplicity in this scaffold; in production
    // this should be a tenant-scoped "my clients" endpoint.
    api.listCorporateAccounts().then(setCorporateOptions).catch(() => setCorporateOptions([]));
  }, []);

  return (
    <div className="app-shell">
      <h1>Travel agent report</h1>
      <p style={{ color: 'var(--text-muted)' }}>Visits across all your corporate clients, with cost, markup, and client charge.</p>
      <SummaryCards />
      <div className="card">
        <VisitsTable
          fixedFilters={{ tenant_id: user.tenant_id }}
          showCorporateFilter
          corporateOptions={corporateOptions.filter(c => c.tenant_id === user.tenant_id)}
        />
      </div>
    </div>
  );
}

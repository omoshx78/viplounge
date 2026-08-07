import { useEffect, useState, useRef } from 'react';
import { getCurrentUser, api } from '../../api/client';
import SummaryCards from '../../components/SummaryCards';
import VisitsTable from '../../components/VisitsTable';
import StatementView from '../../components/StatementView';

export default function AgentDashboard() {
  const user = getCurrentUser();
  const [corporateOptions, setCorporateOptions] = useState([]);
  const tableRef = useRef(null);

  useEffect(() => {
    api.myCorporateAccounts().then(setCorporateOptions).catch(() => setCorporateOptions([]));
  }, []);

  return (
    <div className="app-shell">
      <h1>Travel agent report</h1>
      <p style={{ color: 'var(--text-muted)' }}>Visits across all your corporate clients, with cost, markup, and client charge.</p>
      <SummaryCards onCardClick={() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
      <StatementView fixedPayer={{ payer_type: 'tenant', payer_id: user.tenant_id, label: user.tenant_name || 'Your account' }} />
      <div className="card" ref={tableRef}>
        <VisitsTable
          fixedFilters={{ tenant_id: user.tenant_id }}
          showCorporateFilter
          corporateOptions={corporateOptions}
        />
      </div>
    </div>
  );
}

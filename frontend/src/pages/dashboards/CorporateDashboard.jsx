import { useRef } from 'react';
import { getCurrentUser } from '../../api/client';
import SummaryCards from '../../components/SummaryCards';
import VisitsTable from '../../components/VisitsTable';
import StatementView from '../../components/StatementView';

export default function CorporateDashboard() {
  const user = getCurrentUser();
  const tableRef = useRef(null);
  return (
    <div className="app-shell">
      <h1>Corporate usage report</h1>
      <p style={{ color: 'var(--text-muted)' }}>Staff and consultants who used the lounge on your account, for reconciliation.</p>
      <SummaryCards onCardClick={() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
      <StatementView fixedPayer={{ payer_type: 'corporate_account', payer_id: user.corporate_account_id, label: user.corporate_account_name || 'Your account' }} />
      <div className="card" ref={tableRef}>
        <VisitsTable fixedFilters={{ corporate_account_id: user.corporate_account_id }} />
      </div>
    </div>
  );
}

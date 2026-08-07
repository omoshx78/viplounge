import { getCurrentUser } from '../../api/client';
import SummaryCards from '../../components/SummaryCards';
import VisitsTable from '../../components/VisitsTable';

export default function CorporateDashboard() {
  const user = getCurrentUser();
  return (
    <div className="app-shell">
      <h1>Corporate usage report</h1>
      <p style={{ color: 'var(--text-muted)' }}>Staff and consultants who used the lounge on your account, for reconciliation.</p>
      <SummaryCards />
      <div className="card">
        <VisitsTable fixedFilters={{ corporate_account_id: user.corporate_account_id }} />
      </div>
    </div>
  );
}

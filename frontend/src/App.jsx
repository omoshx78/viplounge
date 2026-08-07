import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { getCurrentUser, clearSession } from './api/client';
import CheckIn from './pages/CheckIn';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import ResetPassword from './pages/ResetPassword';
import StaffVerification from './pages/StaffVerification';
import CorporateDashboard from './pages/dashboards/CorporateDashboard';
import AgentDashboard from './pages/dashboards/AgentDashboard';
import LoungeAdminDashboard from './pages/dashboards/LoungeAdminDashboard';

function RequireRole({ roles, children }) {
  const user = getCurrentUser();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/login" replace />;
  return children;
}

function TopNav() {
  const user = getCurrentUser();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <nav className="topnav no-print">
      <div>
        <Link to="/">Check-in</Link>
        {user.role === 'lounge_staff' && <Link to="/staff">Verification queue</Link>}
        {user.role === 'lounge_admin' && <><Link to="/staff">Verification queue</Link><Link to="/dashboard/lounge-admin">Dashboard</Link></>}
        {user.role === 'travel_agent' && <Link to="/dashboard/agent">My reports</Link>}
        {user.role === 'corporate_admin' && <Link to="/dashboard/corporate">My reports</Link>}
      </div>
      <div>
        <span style={{ marginRight: 12, fontSize: 13, color: 'var(--text-muted)' }}>{user.full_name} ({user.role})</span>
        <Link to="/change-password" style={{ marginRight: 12 }}>Change password</Link>
        <button className="secondary" onClick={() => { clearSession(); navigate('/login'); }}>Sign out</button>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <TopNav />
      <Routes>
        <Route path="/" element={<CheckIn />} />
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/change-password" element={<RequireRole roles={['lounge_admin', 'lounge_staff', 'travel_agent', 'corporate_admin']}><ChangePassword /></RequireRole>} />
        <Route path="/staff" element={<RequireRole roles={['lounge_admin', 'lounge_staff']}><StaffVerification /></RequireRole>} />
        <Route path="/dashboard/lounge-admin" element={<RequireRole roles={['lounge_admin']}><LoungeAdminDashboard /></RequireRole>} />
        <Route path="/dashboard/agent" element={<RequireRole roles={['travel_agent']}><AgentDashboard /></RequireRole>} />
        <Route path="/dashboard/corporate" element={<RequireRole roles={['corporate_admin']}><CorporateDashboard /></RequireRole>} />
      </Routes>
    </BrowserRouter>
  );
}

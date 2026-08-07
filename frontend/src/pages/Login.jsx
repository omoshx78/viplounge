import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../api/client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sessionMessage, setSessionMessage] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const msg = sessionStorage.getItem('vip_lounge_session_message');
    if (msg) {
      setSessionMessage(msg);
      sessionStorage.removeItem('vip_lounge_session_message');
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { token, user } = await api.login(email, password);
      setSession(token, user);
      const dest = {
        lounge_admin: '/dashboard/lounge-admin',
        lounge_staff: '/staff',
        travel_agent: '/dashboard/agent',
        corporate_admin: '/dashboard/corporate',
      }[user.role] || '/';
      navigate(dest);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-page">
      <div className="login-page-inner">
        <div className="login-welcome">
          <div className="eyebrow">Juba International Airport</div>
          <h1>Welcome to the VIP Lounge</h1>
          <p>Sign in to manage check-ins, reports, and stock.</p>
        </div>
        <div className="card">
          {sessionMessage && (
            <div className="badge badge-warning" style={{ marginBottom: 14 }}>{sessionMessage}</div>
          )}
          <form onSubmit={handleSubmit}>
            <label>Email</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label>Password</label>
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <button type="submit" style={{ width: '100%' }}>Sign in</button>
          </form>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setSession } from '../api/client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

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
    <div className="app-shell" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1>Sign in</h1>
        <form onSubmit={handleSubmit}>
          <label>Email</label>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label>Password</label>
          <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button type="submit">Sign in</button>
        </form>
      </div>
    </div>
  );
}

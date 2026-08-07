import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match");
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="app-shell" style={{ maxWidth: 420 }}>
        <div className="card">
          <h1>Reset password</h1>
          <p style={{ color: 'var(--danger)' }}>
            No reset token found in this link. Ask a lounge admin to send you a new reset link.
          </p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="app-shell" style={{ maxWidth: 420 }}>
        <div className="card">
          <h1>Password updated</h1>
          <p>You can now sign in with your new password.</p>
          <button onClick={() => navigate('/login')}>Go to sign in</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1>Set a new password</h1>
        <p style={{ color: 'var(--text-muted)' }}>This link was shared with you by a lounge admin and works once.</p>
        <form onSubmit={handleSubmit}>
          <label>New password (at least 8 characters)</label>
          <input required type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <label>Confirm new password</label>
          <input required type="password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button type="submit" disabled={submitting}>{submitting ? 'Setting password...' : 'Set new password'}</button>
        </form>
      </div>
    </div>
  );
}

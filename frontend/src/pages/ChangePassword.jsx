import { useState } from 'react';
import { api } from '../api/client';

export default function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState('');
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
      await api.changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell" style={{ maxWidth: 420 }}>
      <div className="card">
        <h1>Change password</h1>
        {success && (
          <div className="badge badge-success" style={{ marginBottom: 14 }}>
            Password updated successfully
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <label>Current password</label>
          <input required type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <label>New password (at least 8 characters)</label>
          <input required type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <label>Confirm new password</label>
          <input required type="password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <button type="submit" disabled={submitting}>{submitting ? 'Updating...' : 'Update password'}</button>
        </form>
      </div>
    </div>
  );
}

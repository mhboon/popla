import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePassword } from '../lib/auth';
import { PASSWORD_HINT } from '../lib/password';
import { useAuth } from '../lib/useAuth';

export function AccountPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Account</h1>
      <form onSubmit={handleSubmit} className="auth-form">
        <h2>Change password</h2>
        <label>
          Current password
          <input
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <p>{PASSWORD_HINT}</p>
        {error && <p className="form-error">{error}</p>}
        {success && <p>Password changed.</p>}
        <button type="submit" className="button-primary" disabled={submitting}>
          {submitting ? 'Changing password…' : 'Change password'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          logout();
          navigate('/login');
        }}
      >
        Sign out
      </button>
    </div>
  );
}

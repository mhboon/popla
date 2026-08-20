import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, toAuthenticatedUser } from '../lib/auth';
import { useAuth } from '../lib/useAuth';

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [completeNewPassword, setCompleteNewPassword] =
    useState<((newPassword: string) => Promise<import('amazon-cognito-identity-js').CognitoUserSession>) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(username, password);
      if (result.type === 'newPasswordRequired') {
        setCompleteNewPassword(() => result.completeNewPassword);
        return;
      }
      setUser(toAuthenticatedUser(result.session));
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNewPassword(event: FormEvent) {
    event.preventDefault();
    if (!completeNewPassword) return;
    setError(null);
    setSubmitting(true);
    try {
      const session = await completeNewPassword(newPassword);
      setUser(toAuthenticatedUser(session));
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set new password');
    } finally {
      setSubmitting(false);
    }
  }

  if (completeNewPassword) {
    return (
      <form onSubmit={handleNewPassword} className="auth-form">
        <h1>Set a new password</h1>
        <p>Your temporary password must be changed before continuing.</p>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="button-primary" disabled={submitting}>
          {submitting ? 'Setting password…' : 'Set password and sign in'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleLogin} className="auth-form">
      <h1>Sign in</h1>
      <label>
        Username
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="button-primary" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CognitoUserSession } from 'amazon-cognito-identity-js';
import { login, toAuthenticatedUser } from '../lib/auth';
import { PHONE_HINT, PHONE_PATTERN } from '../lib/phone';
import { PASSWORD_HINT } from '../lib/password';
import { useAuth } from '../lib/useAuth';

// Longer-form than PHONE_HINT (which doubles as a compact `title`
// tooltip elsewhere) — this is the first phone format a new participant
// ever sees, so it spells out the "drop the leading 0, add the country
// code" step explicitly rather than just naming the target format.
const PHONE_FORMAT_HELP =
  "International format, no leading 00 or +. E.g. if your NL number is 0612345678, your login is 31612345678.";

type Mode = 'password' | 'new-password-required';

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('password');

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [completeNewPassword, setCompleteNewPassword] =
    useState<((newPassword: string) => Promise<CognitoUserSession>) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePasswordLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(phone, password);
      if (result.type === 'newPasswordRequired') {
        setCompleteNewPassword(() => result.completeNewPassword);
        setMode('new-password-required');
        return;
      }
      setUser(toAuthenticatedUser(result.session));
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect phone number or password.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteNewPassword(event: FormEvent) {
    event.preventDefault();
    if (!completeNewPassword) return;
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const session = await completeNewPassword(newPassword);
      setUser(toAuthenticatedUser(session));
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set password');
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === 'new-password-required') {
    return (
      <form onSubmit={handleCompleteNewPassword} className="auth-form">
        <h1>Set a new password</h1>
        <p>An admin issued you a temporary password — choose a new one to finish signing in.</p>
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
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <p>{PASSWORD_HINT}</p>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="button-primary" disabled={submitting}>
          {submitting ? 'Setting password…' : 'Set password and sign in'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handlePasswordLogin} className="auth-form">
      <h1>Sign in</h1>
      <label>
        Phone number
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="31612345678"
          pattern={PHONE_PATTERN}
          title={PHONE_HINT}
          autoComplete="username"
          required
        />
      </label>
      <p>{PHONE_FORMAT_HELP}</p>
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
      <p className="hint-text">Forgot your password, or signing in for the first time? Ask an admin for a temporary one.</p>
    </form>
  );
}

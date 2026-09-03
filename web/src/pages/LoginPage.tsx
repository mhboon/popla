import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestOtp, toAuthenticatedUser, type SubmitCodeResult } from '../lib/auth';
import { PHONE_HINT, PHONE_PATTERN } from '../lib/phone';
import { useAuth } from '../lib/useAuth';

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [submitCode, setSubmitCode] =
    useState<((code: string) => Promise<SubmitCodeResult>) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await requestOtp(phone);
      setSubmitCode(() => result.submitCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    if (!submitCode) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await submitCode(code);
      if (result.type === 'incorrect') {
        setSubmitCode(() => result.submitCode);
        setCode('');
        setError('That code was incorrect — try again.');
        return;
      }
      setUser(toAuthenticatedUser(result.session));
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify code');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitCode) {
    return (
      <form onSubmit={handleVerifyCode} className="auth-form">
        <h1>Enter your code</h1>
        <p>We sent a 6-digit code to {phone}. It's valid for 10 minutes.</p>
        <label>
          Code
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            autoFocus
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="button-primary" disabled={submitting}>
          {submitting ? 'Verifying…' : 'Verify and sign in'}
        </button>
        <button
          type="button"
          onClick={() => {
            setSubmitCode(null);
            setCode('');
            setError(null);
          }}
        >
          Use a different number
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleRequestCode} className="auth-form">
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
          autoComplete="tel"
          required
        />
      </label>
      <p>{PHONE_HINT}</p>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="button-primary" disabled={submitting}>
        {submitting ? 'Sending code…' : 'Send code'}
      </button>
    </form>
  );
}

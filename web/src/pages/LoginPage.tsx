import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestOtp, toAuthenticatedUser, type SubmitCodeResult } from '../lib/auth';
import { PHONE_HINT, PHONE_PATTERN } from '../lib/phone';
import { useAuth } from '../lib/useAuth';

// Client-side courtesy only, not a real defense (someone could call
// Cognito directly, bypassing this) — the actual protection against
// spamming a number is the per-phone SMS rate limit in
// infra/lambda/create-auth-challenge/index.ts. This just stops an
// impatient double-tap from firing off extra codes.
const RESEND_COOLDOWN_S = 30;

function describeAuthError(err: unknown, fallback: string): string {
  const code = (err as { code?: string } | undefined)?.code;
  // Cognito's generic wording for a failed/expired CUSTOM_AUTH session
  // (attempt cap hit — see define-auth-challenge's MAX_ATTEMPTS) is a
  // NotAuthorizedException with a password-flow-flavored message that
  // makes no sense in a passwordless app.
  if (code === 'NotAuthorizedException') {
    return 'Too many attempts — request a new code.';
  }
  return err instanceof Error ? err.message : fallback;
}

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [submitCode, setSubmitCode] =
    useState<((code: string) => Promise<SubmitCodeResult>) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    };
  }, []);

  function startResendCooldown() {
    setResendCooldown(RESEND_COOLDOWN_S);
    if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    cooldownInterval.current = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          if (cooldownInterval.current) clearInterval(cooldownInterval.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function sendCode() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await requestOtp(phone);
      setSubmitCode(() => result.submitCode);
      startResendCooldown();
    } catch (err) {
      setError(describeAuthError(err, 'Could not send code'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    await sendCode();
  }

  async function handleResend() {
    if (resendCooldown > 0 || submitting) return;
    setCode('');
    await sendCode();
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
      setError(describeAuthError(err, 'Could not verify code'));
      if ((err as { code?: string } | undefined)?.code === 'NotAuthorizedException') {
        // The CUSTOM_AUTH session is dead (attempt cap hit) — there's
        // nothing left to submit against, so send them back to request
        // a fresh code rather than leaving a dead form on screen.
        setSubmitCode(null);
        setCode('');
      }
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
        <button type="button" onClick={handleResend} disabled={submitting || resendCooldown > 0}>
          {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
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

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CognitoUserSession } from 'amazon-cognito-identity-js';
import {
  login,
  requestOtp,
  toAuthenticatedUser,
  type AuthenticatedUser,
  type SubmitCodeResult,
} from '../lib/auth';
import { setMyPassword } from '../lib/api';
import { config } from '../lib/config';
import { PHONE_HINT, PHONE_PATTERN } from '../lib/phone';
import { PASSWORD_HINT } from '../lib/password';
import { useAuth } from '../lib/useAuth';

// Client-side courtesy only, not a real defense (someone could call
// Cognito directly, bypassing this) — the actual protection against
// spamming a number is the per-phone SMS rate limit in
// infra/lambda/create-auth-challenge/index.ts. This just stops an
// impatient double-tap from firing off extra codes.
const RESEND_COOLDOWN_S = 30;

// Longer-form than PHONE_HINT (which doubles as a compact `title`
// tooltip elsewhere) — this is the first phone format a new participant
// ever sees, so it spells out the "drop the leading 0, add the country
// code" step explicitly rather than just naming the target format.
const PHONE_FORMAT_HELP =
  "International format, no leading 00 or +. E.g. if your NL number is 0612345678, your login is 31612345678.";

type Mode = 'password' | 'otp-request' | 'otp-verify' | 'set-password' | 'new-password-required';

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

  const [mode, setMode] = useState<Mode>('password');

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitCode, setSubmitCode] =
    useState<((code: string) => Promise<SubmitCodeResult>) | null>(null);
  const [completeNewPassword, setCompleteNewPassword] =
    useState<((newPassword: string) => Promise<CognitoUserSession>) | null>(null);
  // The just-authenticated (via OTP) user, held here rather than read back
  // from context — setUser's state update isn't guaranteed to have landed
  // by the time the set-password screen needs a token to call the API.
  const [authedUser, setAuthedUser] = useState<AuthenticatedUser | null>(null);
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

  function goToOtpRequest() {
    setError(null);
    setPassword('');
    setMode('otp-request');
  }

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

  async function sendCode() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await requestOtp(phone);
      setSubmitCode(() => result.submitCode);
      setMode('otp-verify');
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
      const user = toAuthenticatedUser(result.session);
      setUser(user);
      setAuthedUser(user);
      setMode('set-password');
    } catch (err) {
      setError(describeAuthError(err, 'Could not verify code'));
      if ((err as { code?: string } | undefined)?.code === 'NotAuthorizedException') {
        // The CUSTOM_AUTH session is dead (attempt cap hit) — there's
        // nothing left to submit against, so send them back to request
        // a fresh code rather than leaving a dead form on screen.
        setSubmitCode(null);
        setCode('');
        setMode('otp-request');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSetPassword(event: FormEvent) {
    event.preventDefault();
    if (!authedUser) return;
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await setMyPassword(authedUser.idToken, newPassword);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set password');
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === 'set-password') {
    return (
      <form onSubmit={handleSetPassword} className="auth-form">
        <h1>Set a password</h1>
        <p>You need to set a password before continuing.</p>
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
          {submitting ? 'Setting password…' : 'Set password'}
        </button>
      </form>
    );
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

  if (mode === 'otp-verify') {
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
            setMode('otp-request');
          }}
        >
          Use a different number
        </button>
      </form>
    );
  }

  if (mode === 'otp-request') {
    return (
      <form onSubmit={handleRequestCode} className="auth-form">
        <h1>Sign in with a code</h1>
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
        <p>{PHONE_FORMAT_HELP}</p>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="button-primary" disabled={submitting}>
          {submitting ? 'Sending code…' : 'Send code'}
        </button>
        <button type="button" onClick={() => setMode('password')}>
          Back to password sign-in
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
      {config.featureSmsOtp && (
        <button type="button" onClick={goToOtpRequest}>
          Forgot your password?
        </button>
      )}
    </form>
  );
}

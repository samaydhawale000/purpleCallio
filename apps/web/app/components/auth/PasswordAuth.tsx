'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Button } from '../ui/Button';
import { FieldRow, FormError, inputClass } from './profileForm';
import { api } from '../../lib/api';
import { useAuthStore, toAuthUser } from '../../store/auth.store';

type Step =
  | { name: 'login' }
  | { name: 'signup'; initial?: SignupBody }
  | { name: 'verify'; email: string; body: SignupBody; resendAt: number }
  | { name: 'forgot' }
  | { name: 'reset'; email: string; resendAt: number };

/** Mirrors the server: 8–72 characters with a letter and a number. */
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)[\s\S]{8,72}$/;
const PASSWORD_HINT = 'At least 8 characters, with a letter and a number.';

/** The server's message (ValidationPipe sends an array), or a fallback. */
function errorMessage(e: any, fallback: string): string {
  const m = e?.response?.data?.message;
  if (Array.isArray(m)) return m[0] ?? fallback;
  if (typeof m === 'string' && e?.response?.status < 500) return m;
  if (e?.response?.status === 503 && typeof m === 'string') return m;
  return fallback;
}

/**
 * Email + password next to Google sign-in (any email address): sign in, sign up with an
 * emailed code, and forgot/reset password with an emailed code. A successful
 * sign-in stores the session exactly like Google sign-in, so AuthCard then
 * shows onboarding or sends the user on.
 */
export function PasswordAuth({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const { setTokens, setUser } = useAuthStore();
  const [step, setStep] = useState<Step>(mode === 'login' ? { name: 'login' } : { name: 'signup' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const go = (next: Step) => {
    setError('');
    setNotice('');
    setStep(next);
  };

  /** Runs a request with the busy/error state; returns its data or null. */
  const run = async <T,>(request: () => Promise<{ data: T }>, fallback: string): Promise<T | null> => {
    setBusy(true);
    setError('');
    try {
      return (await request()).data;
    } catch (e) {
      setError(errorMessage(e, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const signedIn = (data: any) => {
    setTokens(data.accessToken, data.refreshToken);
    if (data.user) setUser(toAuthUser(data.user));
    // Same rule as Google sign-in: only an explicit false skips onboarding.
    if (data.onboardingRequired === false) router.push('/dashboard');
  };

  switch (step.name) {
    case 'login':
      return (
        <LoginForm
          busy={busy}
          error={error}
          notice={notice}
          onForgot={() => go({ name: 'forgot' })}
          onSubmit={async (email, password) => {
            const data = await run(() => api.post('/auth/login', { email, password }), 'Sign-in failed. Please try again.');
            if (data) signedIn(data);
          }}
        />
      );

    case 'signup':
      return (
        <SignupForm
          initial={step.initial}
          busy={busy}
          error={error}
          onSubmit={async (body) => {
            const data = await run<{ email: string; resendInSeconds: number }>(
              () => api.post('/auth/register', body),
              'We could not send the code. Please try again.',
            );
            if (data) go({ name: 'verify', email: data.email, body, resendAt: Date.now() + data.resendInSeconds * 1000 });
          }}
        />
      );

    case 'verify':
      return (
        <CodeForm
          title="Check your email"
          description={
            <>
              We sent a 6-digit code to <b className="text-[#170B2E]">{step.email}</b>. Enter it to create your account.
            </>
          }
          busy={busy}
          error={error}
          notice={notice}
          resendAt={step.resendAt}
          submitLabel="Verify and create account"
          onBack={() => go({ name: 'signup', initial: step.body })}
          backLabel="Change details"
          onResend={async () => {
            const data = await run<{ resendInSeconds: number }>(
              () => api.post('/auth/register', step.body),
              'We could not send the code. Please try again.',
            );
            if (data) {
              setStep({ ...step, resendAt: Date.now() + data.resendInSeconds * 1000 });
              setNotice('A new code is on its way.');
            }
          }}
          onSubmit={async (code) => {
            const data = await run(() => api.post('/auth/register/verify', { email: step.email, code }), 'Verification failed. Please try again.');
            if (data) signedIn(data);
          }}
        />
      );

    case 'forgot':
      return (
        <ForgotForm
          busy={busy}
          error={error}
          onBack={() => go({ name: 'login' })}
          onSubmit={async (email) => {
            const data = await run<{ resendInSeconds: number }>(
              () => api.post('/auth/password/forgot', { email }),
              'We could not send the code. Please try again.',
            );
            if (data) go({ name: 'reset', email, resendAt: Date.now() + data.resendInSeconds * 1000 });
          }}
        />
      );

    case 'reset':
      return (
        <ResetForm
          email={step.email}
          resendAt={step.resendAt}
          busy={busy}
          error={error}
          notice={notice}
          onBack={() => go({ name: 'forgot' })}
          onResend={async () => {
            const data = await run<{ resendInSeconds: number }>(
              () => api.post('/auth/password/forgot', { email: step.email }),
              'We could not send the code. Please try again.',
            );
            if (data) {
              setStep({ ...step, resendAt: Date.now() + data.resendInSeconds * 1000 });
              setNotice('If the account exists, a new code is on its way.');
            }
          }}
          onSubmit={async (code, password) => {
            const data = await run(
              () => api.post('/auth/password/reset', { email: step.email, code, password }),
              'Password reset failed. Please try again.',
            );
            if (data) signedIn(data);
          }}
        />
      );
  }
}

// ── Steps ───────────────────────────────────────────────────────────────

function LoginForm({
  busy,
  error,
  notice,
  onSubmit,
  onForgot,
}: {
  busy: boolean;
  error: string;
  notice: string;
  onSubmit: (email: string, password: string) => void;
  onForgot: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim() && password) onSubmit(email.trim(), password);
      }}
    >
      <FieldRow id="auth-email" label="Email">
        <input
          id="auth-email"
          type="email"
          className={inputClass()}
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </FieldRow>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="auth-password" className="text-sm font-medium text-[#3D3650]">
            Password
          </label>
          <button type="button" onClick={onForgot} className="text-xs font-medium text-[#7F40E8] hover:text-[#6425C4]">
            Forgot password?
          </button>
        </div>
        <PasswordInput id="auth-password" value={password} onChange={setPassword} autoComplete="current-password" />
      </div>
      <Notice message={notice} />
      <FormError message={error} />
      <Button type="submit" size="lg" loading={busy} disabled={!email.trim() || !password}>
        Sign in
      </Button>
      <p className="text-center text-xs text-[#6B6478]">
        Signed up with Google? Use Continue with Google, or set a password with Forgot password.
      </p>
    </form>
  );
}

type SignupBody = { name: string; email: string; password: string };

function SignupForm({
  initial,
  busy,
  error,
  onSubmit,
}: {
  initial?: SignupBody;
  busy: boolean;
  error: string;
  onSubmit: (body: SignupBody) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState(initial?.password ?? '');
  const [touched, setTouched] = useState(false);

  const invalid = {
    name: !name.trim() && 'Full name is required.',
    email: !/^\S+@\S+\.\S+$/.test(email.trim()) && 'Enter a valid email address.',
    password: !PASSWORD_RE.test(password) && PASSWORD_HINT,
  };
  const show = (k: keyof typeof invalid) => (touched ? invalid[k] || undefined : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(invalid).some(Boolean)) return;
    onSubmit({ name: name.trim(), email: email.trim(), password });
  };

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
      <FieldRow id="signup-name" label="Full name" error={show('name')}>
        <input id="signup-name" className={inputClass(!!show('name'))} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </FieldRow>
      <FieldRow id="signup-email" label="Email" error={show('email')}>
        <input
          id="signup-email"
          type="email"
          className={inputClass(!!show('email'))}
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </FieldRow>
      <FieldRow id="signup-password" label="Password" helper={PASSWORD_HINT} error={show('password')}>
        <PasswordInput id="signup-password" value={password} onChange={setPassword} autoComplete="new-password" invalid={!!show('password')} />
      </FieldRow>
      <FormError message={error} />
      <Button type="submit" size="lg" loading={busy}>
        Create account
      </Button>
    </form>
  );
}

function ForgotForm({
  busy,
  error,
  onSubmit,
  onBack,
}: {
  busy: boolean;
  error: string;
  onSubmit: (email: string) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim()) onSubmit(email.trim());
      }}
    >
      <BackLink onClick={onBack} label="Back to sign in" />
      <div>
        <h3 className="text-lg font-semibold text-[#170B2E]">Reset your password</h3>
        <p className="mt-1 text-sm text-[#6B6478]">Enter the email you signed up with and we&apos;ll send you a code.</p>
      </div>
      <FieldRow id="forgot-email" label="Email">
        <input
          id="forgot-email"
          type="email"
          className={inputClass()}
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </FieldRow>
      <FormError message={error} />
      <Button type="submit" size="lg" loading={busy} disabled={!email.trim()}>
        Send code
      </Button>
    </form>
  );
}

function ResetForm({
  email,
  resendAt,
  busy,
  error,
  notice,
  onSubmit,
  onResend,
  onBack,
}: {
  email: string;
  resendAt: number;
  busy: boolean;
  error: string;
  notice: string;
  onSubmit: (code: string, password: string) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const weak = !PASSWORD_RE.test(password);
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (code.length === 6 && !weak) onSubmit(code, password);
      }}
    >
      <BackLink onClick={onBack} label="Use a different email" />
      <div>
        <h3 className="text-lg font-semibold text-[#170B2E]">Enter the code</h3>
        <p className="mt-1 text-sm text-[#6B6478]">
          If <b className="text-[#170B2E]">{email}</b> has an account, we&apos;ve sent it a 6-digit code.
          It expires in 10 minutes.
        </p>
      </div>
      <CodeInput value={code} onChange={setCode} />
      <FieldRow id="reset-password" label="New password" helper={PASSWORD_HINT} error={touched && weak ? PASSWORD_HINT : undefined}>
        <PasswordInput id="reset-password" value={password} onChange={setPassword} autoComplete="new-password" invalid={touched && weak} />
      </FieldRow>
      <Notice message={notice} />
      <FormError message={error} />
      <Button type="submit" size="lg" loading={busy} disabled={code.length !== 6}>
        Reset password and sign in
      </Button>
      <ResendButton resendAt={resendAt} onResend={onResend} disabled={busy} />
    </form>
  );
}

function CodeForm({
  title,
  description,
  busy,
  error,
  notice,
  resendAt,
  submitLabel,
  onSubmit,
  onResend,
  onBack,
  backLabel,
}: {
  title: string;
  description: ReactNode;
  busy: boolean;
  error: string;
  notice: string;
  resendAt: number;
  submitLabel: string;
  onSubmit: (code: string) => void;
  onResend: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  const [code, setCode] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) onSubmit(code);
      }}
    >
      <BackLink onClick={onBack} label={backLabel} />
      <div>
        <h3 className="text-lg font-semibold text-[#170B2E]">{title}</h3>
        <p className="mt-1 text-sm text-[#6B6478]">{description} It expires in 10 minutes.</p>
      </div>
      <CodeInput value={code} onChange={setCode} />
      <Notice message={notice} />
      <FormError message={error} />
      <Button type="submit" size="lg" loading={busy} disabled={code.length !== 6}>
        {submitLabel}
      </Button>
      <ResendButton resendAt={resendAt} onResend={onResend} disabled={busy} />
    </form>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        className={`${inputClass(invalid)} pr-10`}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-[#6B6478] hover:text-[#170B2E]"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <FieldRow id="auth-code" label="6-digit code">
      <input
        id="auth-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className={`${inputClass()} text-center font-mono text-xl tracking-[0.5em]`}
        placeholder="••••••"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </FieldRow>
  );
}

function ResendButton({ resendAt, onResend, disabled }: { resendAt: number; onResend: () => void; disabled?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (now >= resendAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [now, resendAt]);
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  return (
    <p className="text-center text-xs text-[#6B6478]">
      Didn&apos;t get it? Check spam, or{' '}
      {wait > 0 ? (
        <span>resend in {wait}s</span>
      ) : (
        <button type="button" onClick={onResend} disabled={disabled} className="font-medium text-[#7F40E8] hover:text-[#6425C4] disabled:opacity-50">
          resend the code
        </button>
      )}
    </p>
  );
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 self-start text-xs font-medium text-[#6B6478] hover:text-[#170B2E]">
      <ArrowLeft size={14} /> {label}
    </button>
  );
}

function Notice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-lg border border-[#D6C4EE] bg-[#F8F4FD] px-4 py-3 text-sm text-[#3D3650]">
      {message}
    </p>
  );
}

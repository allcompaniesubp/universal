/**
 * Registration, sign-in and email verification pages.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, type PublicUser } from '../lib/api.ts';
import { useAuth } from '../lib/auth-context.tsx';
import { Alert, Button, Card, Container, Field, inputClass } from '../components/ui.tsx';

function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
        <Card className="mt-6 p-6">{children}</Card>
        <div className="mt-5 text-center text-sm text-slate-600">{footer}</div>
      </div>
    </Container>
  );
}

export function RegisterPage() {
  const { setUser } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [verificationNotice, setVerificationNotice] = useState<{
    delivered: boolean;
    message: string;
    link?: string;
  } | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFields({});

    try {
      const result = await api.register({ email, password, fullName });
      setUser(result.user);

      if (result.emailVerification.delivered) {
        setVerificationNotice({
          delivered: true,
          message:
            'Your account has been created. Check your email for the confirmation link to verify your address.',
        });
      } else {
        // Honest state: no email provider is configured, so say so and give the
        // owner the link directly rather than implying a message was sent.
        setVerificationNotice({
          delivered: false,
          message: result.emailVerification.message,
          link: result.emailVerification.verificationUrl,
        });
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFields(caught.fields);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (verificationNotice) {
    return (
      <AuthShell
        title="Your account is ready"
        subtitle="One more step to confirm your email address."
        footer={
          <Link to="/dashboard" className="font-medium text-navy-700 hover:text-navy-900">
            Continue to your dashboard →
          </Link>
        }
      >
        <Alert
          tone={verificationNotice.delivered ? 'success' : 'warning'}
          title={verificationNotice.delivered ? 'Confirmation email sent' : 'Email delivery is not configured'}
        >
          <p>{verificationNotice.message}</p>
          {verificationNotice.link && (
            <div className="mt-3">
              <p className="text-xs">
                Open this link to confirm your address. It is shown here only because this deployment
                has no email provider configured:
              </p>
              <a
                href={verificationNotice.link}
                className="mt-1.5 block break-all rounded bg-white/70 px-2 py-1.5 font-mono text-xs text-navy-800 underline"
              >
                {verificationNotice.link}
              </a>
            </div>
          )}
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Register your business"
      subtitle="Create an account to set up your business profile and Universal Business Passport."
      footer={
        <>
          Already registered?{' '}
          <Link to="/signin" className="font-medium text-navy-700 hover:text-navy-900">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Your name" htmlFor="fullName" required error={fields.fullName}>
          <input
            id="fullName"
            name="fullName"
            autoComplete="name"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(fields.fullName)}
          />
        </Field>

        <Field label="Business email" htmlFor="email" required error={fields.email}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(fields.email)}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          required
          error={fields.password}
          hint="At least 12 characters. A longer passphrase is better than a short complex password."
        >
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
            aria-invalid={Boolean(fields.password)}
          />
        </Field>

        <Button type="submit" disabled={submitting} fullWidth>
          {submitting ? 'Creating your account…' : 'Create account'}
        </Button>

        <p className="text-xs leading-relaxed text-slate-500">
          By registering you confirm the information you provide is accurate. The Universal Business
          Passport is a private business identity credential issued by AllCompanies and is not a
          government document.
        </p>
      </form>
    </AuthShell>
  );
}

export function SignInPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.login({ email, password });
      setUser(result.user as PublicUser);
      navigate('/dashboard');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Access your dashboard, business profiles and passport."
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-medium text-navy-700 hover:text-navy-900">
            Register your business
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Email" htmlFor="signin-email" required>
          <input
            id="signin-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Password" htmlFor="signin-password" required>
          <input
            id="signin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Button type="submit" disabled={submitting} fullWidth>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

/**
 * Email verification landing page.
 *
 * Consumes the single-use token from the link. The server is the only authority
 * on the outcome, so the page reports exactly what the server returned.
 */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<
    { kind: 'pending' } | { kind: 'done'; message: string } | { kind: 'error'; message: string }
  >({ kind: 'pending' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its verification token.' });
      return;
    }
    let cancelled = false;
    api
      .verifyEmail(token)
      .then((result) => {
        if (!cancelled) setState({ kind: 'done', message: result.message });
      })
      .catch((caught) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: caught instanceof ApiError ? caught.message : 'The link could not be verified.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthShell
      title="Confirm your email address"
      subtitle="This link can be used once and expires after 24 hours."
      footer={
        <Link to="/dashboard" className="font-medium text-navy-700 hover:text-navy-900">
          Go to your dashboard →
        </Link>
      }
    >
      {state.kind === 'pending' && <Alert tone="info">Confirming your address…</Alert>}
      {state.kind === 'done' && (
        <Alert tone="success" title="Confirmed">
          {state.message}
        </Alert>
      )}
      {state.kind === 'error' && (
        <Alert tone="error" title="Not confirmed">
          {state.message}
        </Alert>
      )}
    </AuthShell>
  );
}

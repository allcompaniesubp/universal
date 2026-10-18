/**
 * Business dashboard.
 *
 * Every value shown here comes from the database. There are no sample metrics,
 * no placeholder charts and no invented counts: when a business has no data the
 * relevant section shows an empty state instead.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type Business, type BusinessDetailResponse } from '../lib/api.ts';
import { useAuth } from '../lib/auth-context.tsx';
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  EmptyState,
  Field,
  Spinner,
  StatusBadge,
  inputClass,
} from '../components/ui.tsx';
import { PassportCard } from '../components/passport-card.tsx';
import { formatDate } from '../lib/format.ts';

export function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/signin');
      return;
    }
    let cancelled = false;
    api
      .listMyBusinesses()
      .then((result) => {
        if (!cancelled) setBusinesses(result.businesses);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Could not load your businesses.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, navigate]);

  if (authLoading) {
    return (
      <Container className="py-16">
        <Spinner label="Loading your account" />
      </Container>
    );
  }

  if (!user) return null;

  const publishedCount = businesses?.filter((business) => business.status === 'published').length ?? 0;

  return (
    <Container className="py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {user.fullName} ({user.email})
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={user.emailVerified ? 'good' : 'warn'}>
              {user.emailVerified ? 'Email verified' : 'Email not yet verified'}
            </Badge>
            <Badge tone="neutral">Role: {user.role}</Badge>
          </div>
        </div>
        <Link to="/businesses/new">
          <Button>Add a business</Button>
        </Link>
      </header>

      {!user.emailVerified && (
        <div className="mt-6">
          <Alert tone="warning" title="Confirm your email address">
            Your account can create profiles, but the “email verified” level will only be recorded
            once you follow the confirmation link sent when you registered. If email delivery is not
            configured on this deployment, the link was shown on the registration screen.
          </Alert>
        </div>
      )}

      {error && (
        <div className="mt-6">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <section className="mt-8" aria-labelledby="your-businesses">
        <div className="flex items-end justify-between gap-3">
          <h2 id="your-businesses" className="text-lg font-semibold">
            Your businesses
          </h2>
          {businesses && businesses.length > 0 && (
            <p className="text-sm text-slate-500">
              {businesses.length} total · {publishedCount} published
            </p>
          )}
        </div>

        <div className="mt-4">
          {!businesses && !error && <Spinner label="Loading your businesses" />}

          {businesses && businesses.length === 0 && (
            <EmptyState title="You have not created a business yet">
              <p>
                Create a profile to receive your unique UBP identifier, QR code and digital business
                card, and to appear in the public directory once published.
              </p>
              <div className="mt-4">
                <Link to="/businesses/new">
                  <Button>Create your first business</Button>
                </Link>
              </div>
            </EmptyState>
          )}

          {businesses && businesses.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {businesses.map((business) => {
                const held = business.verification.filter((entry) => entry.held);
                return (
                  <Card key={business.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-navy-900">
                          {business.displayName}
                        </h3>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">{business.ubpId}</p>
                      </div>
                      <StatusBadge status={business.status} />
                    </div>

                    {business.tagline && (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-600">{business.tagline}</p>
                    )}

                    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="text-slate-500">Public address</dt>
                        <dd className="truncate font-medium text-slate-800">/business/{business.slug}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Verification levels held</dt>
                        <dd className="font-medium text-slate-800">
                          {held.length} of {business.verification.length}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Created</dt>
                        <dd className="font-medium text-slate-800">{formatDate(business.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Published</dt>
                        <dd className="font-medium text-slate-800">
                          {formatDate(business.publishedAt) ?? 'Not published'}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link to={`/businesses/${business.id}/edit`}>
                        <Button tone="secondary">Edit profile</Button>
                      </Link>
                      <Link to={`/businesses/${business.id}/passport`}>
                        <Button tone="ghost">Passport &amp; card</Button>
                      </Link>
                      {business.status === 'published' && (
                        <Link to={`/business/${business.slug}`}>
                          <Button tone="ghost">View public page</Button>
                        </Link>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

interface FormState {
  displayName: string;
  slug: string;
  tagline: string;
  description: string;
  category: string;
  countryCode: string;
  region: string;
  city: string;
  websiteUrl: string;
  contactEmail: string;
  contactPhone: string;
  languages: string;
  showEmailPublicly: boolean;
  showPhonePublicly: boolean;
}

const EMPTY_FORM: FormState = {
  displayName: '',
  slug: '',
  tagline: '',
  description: '',
  category: '',
  countryCode: '',
  region: '',
  city: '',
  websiteUrl: '',
  contactEmail: '',
  contactPhone: '',
  languages: '',
  showEmailPublicly: false,
  showPhonePublicly: false,
};

function toFormState(business: Business): FormState {
  return {
    displayName: business.displayName,
    slug: business.slug,
    tagline: business.tagline ?? '',
    description: business.description ?? '',
    category: business.category ?? '',
    countryCode: business.countryCode ?? '',
    region: business.region ?? '',
    city: business.city ?? '',
    websiteUrl: business.websiteUrl ?? '',
    contactEmail: business.contactEmail ?? '',
    contactPhone: business.contactPhone ?? '',
    languages: business.languages.join(', '),
    showEmailPublicly: business.showEmailPublicly,
    showPhonePublicly: business.showPhonePublicly,
  };
}

/** Converts the form state into the JSON payload the API expects. */
function toPayload(form: FormState): Record<string, unknown> {
  return {
    displayName: form.displayName,
    slug: form.slug,
    tagline: form.tagline,
    description: form.description,
    category: form.category,
    countryCode: form.countryCode,
    region: form.region,
    city: form.city,
    websiteUrl: form.websiteUrl,
    contactEmail: form.contactEmail,
    contactPhone: form.contactPhone,
    languages: form.languages
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    showEmailPublicly: form.showEmailPublicly,
    showPhonePublicly: form.showPhonePublicly,
  };
}

export function BusinessFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const businessId = mode === 'edit' ? window.location.pathname.split('/')[2] ?? '' : '';

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [slugNotice, setSlugNotice] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Business | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/signin');
      return;
    }
    if (mode !== 'edit') {
      setLoading(false);
      return;
    }

    let cancelled = false;
    api
      .getBusiness(businessId)
      .then((response: BusinessDetailResponse) => {
        if (cancelled) return;
        // The API only returns the full owner view to the owner. If a
        // non-owner somehow reached this route, `viewer` would be "public".
        if (response.viewer !== 'owner') {
          setError('You do not have permission to edit this business.');
          return;
        }
        const business = response.business as Business;
        setLoaded(business);
        setForm(toFormState(business));
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Could not load this business.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessId, mode, user, authLoading, navigate]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  }, []);

  async function suggestSlug() {
    if (form.displayName.trim().length < 2) {
      setSlugNotice('Enter a business name first.');
      return;
    }
    try {
      const result = await api.slugSuggestion(form.displayName);
      update('slug', result.slug);
      setSlugNotice('Suggested from your business name. You can change it.');
    } catch {
      setSlugNotice('Could not suggest an address right now.');
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFields({});

    try {
      if (mode === 'create') {
        const result = await api.createBusiness(toPayload(form));
        navigate(`/businesses/${result.business.id}/passport`);
      } else {
        const result = await api.updateBusiness(businessId, toPayload(form));
        setLoaded(result.business);
        setError(null);
        setFields({});
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setSavedNotice('Your changes have been saved.');
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFields(caught.fields);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return (
      <Container className="py-16">
        <Spinner label="Loading" />
      </Container>
    );
  }

  if (!user) return null;

  if (error && mode === 'edit' && !loaded) {
    return (
      <Container className="py-16">
        <Alert tone="error" title="Cannot open this business">
          {error}
        </Alert>
      </Container>
    );
  }

  return (
    <Container className="py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">
          {mode === 'create' ? 'Create a business profile' : `Edit ${loaded?.displayName ?? 'business'}`}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {mode === 'create'
            ? 'Your profile starts as a draft. You will receive a unique UBP identifier immediately and can publish when you are ready.'
            : 'Changes are saved to your profile immediately. Publishing is a separate step.'}
        </p>

        {savedNotice && (
          <div className="mt-6">
            <Alert tone="success">{savedNotice}</Alert>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-6" noValidate>
          {error && <Alert tone="error">{error}</Alert>}

          <Card className="space-y-5 p-6">
            <h2 className="text-base font-semibold">Identity</h2>

            <Field label="Business name" htmlFor="displayName" required error={fields.displayName}>
              <input
                id="displayName"
                value={form.displayName}
                onChange={(event) => update('displayName', event.target.value)}
                className={inputClass}
                required
                maxLength={120}
              />
            </Field>

            <Field
              label="Public web address"
              htmlFor="slug"
              required
              error={fields.slug}
              hint={
                slugNotice ??
                'Lowercase letters, digits and hyphens. This becomes /business/your-address'
              }
            >
              <div className="flex gap-2">
                <span className="hidden items-center rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-500 sm:inline-flex">
                  /business/
                </span>
                <input
                  id="slug"
                  value={form.slug}
                  onChange={(event) => update('slug', event.target.value.toLowerCase())}
                  className={inputClass}
                  required
                  maxLength={64}
                  pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]"
                />
                {mode === 'create' && (
                  <Button tone="secondary" onClick={suggestSlug}>
                    Suggest
                  </Button>
                )}
              </div>
            </Field>

            <Field
              label="Tagline"
              htmlFor="tagline"
              error={fields.tagline}
              hint="One short line describing what you do. Required before publishing if you have no description."
            >
              <input
                id="tagline"
                value={form.tagline}
                onChange={(event) => update('tagline', event.target.value)}
                className={inputClass}
                maxLength={160}
              />
            </Field>

            <Field
              label="Description"
              htmlFor="description"
              error={fields.description}
              hint="What your business does, who it serves, and what makes it useful to a buyer."
            >
              <textarea
                id="description"
                value={form.description}
                onChange={(event) => update('description', event.target.value)}
                className={`${inputClass} min-h-32`}
                maxLength={4000}
              />
            </Field>

            <Field label="Category" htmlFor="category" error={fields.category}>
              <input
                id="category"
                value={form.category}
                onChange={(event) => update('category', event.target.value)}
                className={inputClass}
                maxLength={80}
                placeholder="e.g. Manufacturing, Professional services, Textiles"
              />
            </Field>
          </Card>

          <Card className="space-y-5 p-6">
            <h2 className="text-base font-semibold">Location and languages</h2>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Country code"
                htmlFor="countryCode"
                error={fields.countryCode}
                hint="Two-letter ISO code, e.g. IN, US, GB."
              >
                <input
                  id="countryCode"
                  value={form.countryCode}
                  onChange={(event) => update('countryCode', event.target.value.toUpperCase())}
                  className={inputClass}
                  maxLength={2}
                />
              </Field>

              <Field label="Region or state" htmlFor="region" error={fields.region}>
                <input
                  id="region"
                  value={form.region}
                  onChange={(event) => update('region', event.target.value)}
                  className={inputClass}
                  maxLength={120}
                />
              </Field>

              <Field label="City" htmlFor="city" error={fields.city}>
                <input
                  id="city"
                  value={form.city}
                  onChange={(event) => update('city', event.target.value)}
                  className={inputClass}
                  maxLength={120}
                />
              </Field>

              <Field
                label="Languages supported"
                htmlFor="languages"
                error={fields.languages}
                hint="Comma separated, e.g. English, Hindi, Arabic."
              >
                <input
                  id="languages"
                  value={form.languages}
                  onChange={(event) => update('languages', event.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          </Card>

          <Card className="space-y-5 p-6">
            <h2 className="text-base font-semibold">Contact</h2>

            <Field label="Website" htmlFor="websiteUrl" error={fields.websiteUrl} hint="Must begin with http:// or https://">
              <input
                id="websiteUrl"
                value={form.websiteUrl}
                onChange={(event) => update('websiteUrl', event.target.value)}
                className={inputClass}
                maxLength={500}
                placeholder="https://example.com"
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Contact email" htmlFor="contactEmail" error={fields.contactEmail}>
                <input
                  id="contactEmail"
                  type="email"
                  value={form.contactEmail}
                  onChange={(event) => update('contactEmail', event.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Contact phone" htmlFor="contactPhone" error={fields.contactPhone}>
                <input
                  id="contactPhone"
                  value={form.contactPhone}
                  onChange={(event) => update('contactPhone', event.target.value)}
                  className={inputClass}
                  maxLength={40}
                />
              </Field>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-slate-800">Privacy</legend>
              <p className="text-xs text-slate-500">
                Contact details are never shown unless you allow it here, and are never shown at all
                while the profile is unpublished.
              </p>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.showEmailPublicly}
                  onChange={(event) => update('showEmailPublicly', event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>Show my contact email on the public page</span>
              </label>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.showPhonePublicly}
                  onChange={(event) => update('showPhonePublicly', event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>Show my contact phone number on the public page</span>
              </label>
            </fieldset>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : mode === 'create' ? 'Create business profile' : 'Save changes'}
            </Button>
            <Button tone="ghost" onClick={() => navigate('/dashboard')}>
              Cancel
            </Button>
          </div>
        </form>

        {mode === 'edit' && loaded && (
          <Card className="mt-8 p-6">
            <h2 className="text-base font-semibold">Publication</h2>
            <p className="mt-1 text-sm text-slate-600">
              Current status: <StatusBadge status={loaded.status} />
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {loaded.status === 'published'
                ? 'Your profile is visible in the directory and at its public address.'
                : 'Your profile is not publicly visible.'}
            </p>
            <div className="mt-4">
              {loaded.status === 'published' ? (
                <UnpublishButton businessId={loaded.id} onDone={setLoaded} />
              ) : loaded.status === 'suspended' ? (
                <Alert tone="error">
                  This business has been suspended and cannot be published from here.
                </Alert>
              ) : (
                <PublishButton businessId={loaded.id} onDone={setLoaded} />
              )}
            </div>
          </Card>
        )}
      </div>
    </Container>
  );
}

function PublishButton({ businessId, onDone }: { businessId: string; onDone: (business: Business) => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    setWorking(true);
    setError(null);
    try {
      const result = await api.publishBusiness(businessId);
      onDone(result.business);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not publish.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}
      <Button onClick={publish} disabled={working}>
        {working ? 'Publishing…' : 'Publish profile'}
      </Button>
    </div>
  );
}

function UnpublishButton({ businessId, onDone }: { businessId: string; onDone: (business: Business) => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unpublish() {
    setWorking(true);
    setError(null);
    try {
      const result = await api.unpublishBusiness(businessId);
      onDone(result.business);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not unpublish.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}
      <Button tone="secondary" onClick={unpublish} disabled={working}>
        {working ? 'Updating…' : 'Unpublish profile'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Passport / card
// ---------------------------------------------------------------------------

export function BusinessPassportPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const businessId = window.location.pathname.split('/')[2] ?? '';

  const [data, setData] = useState<BusinessDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/signin');
      return;
    }
    let cancelled = false;
    api
      .getBusiness(businessId)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Could not load this passport.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, user, authLoading, navigate]);

  if (authLoading) {
    return (
      <Container className="py-16">
        <Spinner label="Loading" />
      </Container>
    );
  }

  if (!user) return null;

  if (error) {
    return (
      <Container className="py-16">
        <Alert tone="error" title="Cannot open this passport">
          {error}
        </Alert>
      </Container>
    );
  }

  if (!data) {
    return (
      <Container className="py-16">
        <Spinner label="Loading passport" />
      </Container>
    );
  }

  const business = data.business as Business;
  const held = business.verification.filter((entry) => entry.held);

  async function copyVerificationUrl() {
    try {
      await navigator.clipboard.writeText(data!.verificationUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Container className="py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">Passport &amp; digital card</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your passport card is a membership and identity credential. It is not a payment card and
          carries no payment functionality.
        </p>

        <div className="mt-8">
          <PassportCard business={business} verificationUrl={data.verificationUrl} qrCodeUrl={data.qrCodeUrl} />
        </div>

        <div className="no-print mt-8 flex flex-wrap gap-3">
          <a href={data.qrCodeUrl} download={`${business.ubpId}-qr.svg`}>
            <Button tone="secondary">Download QR code (SVG)</Button>
          </a>
          <a href={`/api/businesses/${business.id}/card.vcf`}>
            <Button tone="secondary">Download digital card (vCard)</Button>
          </a>
          <Button tone="ghost" onClick={() => window.print()}>
            Print card
          </Button>
        </div>

        <Card className="mt-8 p-6">
          <h2 className="text-base font-semibold">Share and verify</h2>
          <dl className="mt-4 space-y-4 text-sm">
            <div>
              <dt className="text-slate-500">Public profile address</dt>
              <dd className="mt-1 break-all">
                <a href={data.publicUrl} className="font-medium text-navy-700 hover:text-navy-900">
                  {data.publicUrl}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Public verification address (this is what the QR code opens)</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <a
                  href={data.verificationUrl}
                  className="break-all font-mono text-xs text-navy-700 hover:text-navy-900"
                >
                  {data.verificationUrl}
                </a>
                <Button tone="ghost" onClick={copyVerificationUrl}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            The QR code encodes only this public verification address. It contains no private
            information and no token, so anyone who scans it can confirm the passport’s status and
            nothing more.
          </p>
        </Card>

        <Card className="mt-8 p-6">
          <h2 className="text-base font-semibold">Verification status</h2>
          <p className="mt-1 text-sm text-slate-600">
            {held.length} of {business.verification.length} levels currently held.
          </p>
          <div className="mt-4 divide-y divide-slate-100">
            {business.verification.map((entry) => (
              <div key={entry.level} className="flex items-start justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-slate-800">{entry.label}</p>
                  {entry.checkedAt && (
                    <p className="text-xs text-slate-500">
                      Checked {new Date(entry.checkedAt).toLocaleDateString()}
                      {entry.checkedBy ? ` by ${entry.checkedBy}` : ''}
                    </p>
                  )}
                </div>
                <Badge tone={entry.held ? 'good' : entry.status === 'pending' ? 'warn' : 'neutral'}>
                  {entry.held
                    ? 'Held'
                    : entry.status === 'not_started'
                      ? 'Not checked yet'
                      : entry.status === 'pending'
                        ? 'In review'
                        : entry.status}
                </Badge>
              </div>
            ))}
          </div>
          <Link to={`/businesses/${business.id}/edit`} className="mt-4 inline-block">
            <Button tone="ghost">Back to profile</Button>
          </Link>
        </Card>
      </div>
    </Container>
  );
}


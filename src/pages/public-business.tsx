/**
 * Public business micro-page (/business/<slug>) and the public verification
 * page (/verify/<ubpId>).
 *
 * Both read only the public projection. Contact details appear solely when the
 * owner opted in and the business is published; a draft, unpublished or
 * suspended profile is not readable by a visitor at all.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type PublicBusiness, type VerificationResponse } from '../lib/api.ts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Container,
  Spinner,
  StatusBadge,
  VerificationPanel,
} from '../components/ui.tsx';
import { countryLabel, formatDate } from '../lib/format.ts';

export function PublicBusinessPage() {
  const { slug } = useParams<{ slug: string }>();
  const [business, setBusiness] = useState<PublicBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);

    api
      .businessBySlug(slug)
      .then((response) => {
        if (!cancelled) setBusiness(response.business as PublicBusiness);
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 404) setNotFound(true);
        else setError(caught instanceof ApiError ? caught.message : 'Could not load this business.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <Container className="py-16">
        <Spinner label="Loading business profile" />
      </Container>
    );
  }

  if (notFound) {
    return (
      <Container className="py-16">
        <div className="mx-auto max-w-lg text-center">
          <h1 className="text-2xl font-semibold">No business at this address</h1>
          <p className="mt-3 text-sm text-slate-600">
            This address does not match a published business. The profile may not exist, may still be a
            draft, or may have been unpublished by its owner.
          </p>
          <Link to="/discover" className="mt-6 inline-block">
            <Button tone="secondary">Browse the directory</Button>
          </Link>
        </div>
      </Container>
    );
  }

  if (error || !business) {
    return (
      <Container className="py-16">
        <Alert tone="error" title="Could not load this profile">
          {error ?? 'An unexpected error occurred.'}
        </Alert>
      </Container>
    );
  }

  const held = business.verification.filter((entry) => entry.held);
  const location = [business.city, business.region, countryLabel(business.countryCode)]
    .filter(Boolean)
    .join(', ');

  return (
    <Container className="py-10">
      <div className="mx-auto max-w-4xl">
        <nav aria-label="Breadcrumb" className="text-xs text-slate-500">
          <Link to="/discover" className="hover:text-navy-900">
            Directory
          </Link>
          <span aria-hidden="true" className="mx-1.5">
            /
          </span>
          <span>{business.displayName}</span>
        </nav>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold sm:text-3xl">{business.displayName}</h1>
            {business.tagline && <p className="mt-2 text-base text-slate-600">{business.tagline}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-slate-500">{business.ubpId}</span>
              <StatusBadge status={business.status} />
              {held.map((entry) => (
                <Badge key={entry.level} tone="good">
                  {entry.label}
                </Badge>
              ))}
            </div>
          </div>
          <Link to={`/verify/${business.ubpId}`}>
            <Button tone="secondary">Verify this passport</Button>
          </Link>
        </header>

        {business.status !== 'published' && (
          <div className="mt-6">
            <Alert tone="warning" title="This profile is not published">
              You are seeing this page because you own it. It is not visible in the directory and
              cannot be read by visitors.
            </Alert>
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card className="p-6">
              <h2 className="text-base font-semibold">About</h2>
              {business.description ? (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                  {business.description}
                </p>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  This business has not added a description yet.
                </p>
              )}
            </Card>

            <Card className="p-6">
              <h2 className="text-base font-semibold">Verification status</h2>
              <p className="mt-1 text-sm text-slate-600">
                {held.length} of {business.verification.length} levels currently held. Each entry states
                exactly what was checked.
              </p>
              <div className="mt-4">
                <VerificationPanel entries={business.verification} />
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-base font-semibold">Products and services</h2>
              <p className="mt-3 text-sm text-slate-500">
                Product and service listings are not available yet. They are scheduled for Phase 2 and
                no listings are shown until then.
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="text-base font-semibold">Reviews</h2>
              <p className="mt-3 text-sm text-slate-500">
                There is no review system yet, so no ratings are displayed. We do not show invented or
                imported reviews. A review feature with verified-purchase distinction is planned for a
                later phase.
              </p>
            </Card>
          </div>

          <aside className="space-y-6">
            <Card className="p-6">
              <h2 className="text-base font-semibold">Contact</h2>
              <dl className="mt-4 space-y-3 text-sm">
                {location && (
                  <div>
                    <dt className="text-slate-500">Location</dt>
                    <dd className="font-medium text-slate-800">{location}</dd>
                  </div>
                )}
                {business.languages.length > 0 && (
                  <div>
                    <dt className="text-slate-500">Languages</dt>
                    <dd className="font-medium text-slate-800">{business.languages.join(', ')}</dd>
                  </div>
                )}
                {business.websiteUrl && (
                  <div>
                    <dt className="text-slate-500">Website</dt>
                    <dd>
                      <a
                        href={business.websiteUrl}
                        rel="nofollow noopener noreferrer"
                        target="_blank"
                        className="break-all font-medium text-navy-700 hover:text-navy-900"
                      >
                        {business.websiteUrl}
                      </a>
                    </dd>
                  </div>
                )}
                {business.contactEmail && (
                  <div>
                    <dt className="text-slate-500">Email</dt>
                    <dd>
                      <a
                        href={`mailto:${business.contactEmail}`}
                        className="break-all font-medium text-navy-700 hover:text-navy-900"
                      >
                        {business.contactEmail}
                      </a>
                    </dd>
                  </div>
                )}
                {business.contactPhone && (
                  <div>
                    <dt className="text-slate-500">Phone</dt>
                    <dd className="font-medium text-slate-800">{business.contactPhone}</dd>
                  </div>
                )}
                {!business.websiteUrl && !business.contactEmail && !business.contactPhone && (
                  <p className="text-sm text-slate-500">
                    This business has not published contact details.
                  </p>
                )}
              </dl>
            </Card>

            <Card className="p-6">
              <h2 className="text-base font-semibold">Passport</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-slate-500">UBP identifier</dt>
                  <dd className="font-mono font-medium text-slate-800">{business.ubpId}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Profile created</dt>
                  <dd className="font-medium text-slate-800">{formatDate(business.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Published</dt>
                  <dd className="font-medium text-slate-800">
                    {formatDate(business.publishedAt) ?? 'Not published'}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 rounded-lg bg-white p-2 ring-1 ring-slate-200">
                <PublicQr ubpId={business.ubpId} />
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </Container>
  );
}

/**
 * QR image for the public page.
 *
 * Addressed by UBP identifier rather than the internal UUID, because the public
 * projection deliberately does not expose a business's UUID. The endpoint is
 * read-only and returns the same payload the passport card uses.
 */
function PublicQr({ ubpId }: { ubpId: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <p className="p-2 text-xs text-slate-500">QR code is unavailable.</p>;
  }

  return (
    <img
      src={`/api/verify-qr/${encodeURIComponent(ubpId)}.svg`}
      alt={`QR code linking to the public verification page for ${ubpId}`}
      className="h-28 w-28"
      width={112}
      height={112}
      onError={() => setFailed(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Verification page
// ---------------------------------------------------------------------------

export function VerifyPage() {
  const { ubpId } = useParams<{ ubpId: string }>();
  const [result, setResult] = useState<VerificationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!ubpId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);
    setResult(null);

    api
      .verify(ubpId)
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 404) setNotFound(true);
        else setError(caught instanceof ApiError ? caught.message : 'Verification failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ubpId]);

  const held = result?.verification.filter((entry) => entry.held) ?? [];

  return (
    <Container className="py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">Verify a Universal Business Passport</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Enter a UBP identifier to see the passport’s real, current status. This page reports only
          checks that have actually been recorded, together with what each check does and does not
          assert.
        </p>

        <form
          className="mt-6 flex flex-wrap gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const cleaned = query.trim().toUpperCase();
            if (cleaned.length > 0) window.location.href = `/verify/${encodeURIComponent(cleaned)}`;
          }}
        >
          <label htmlFor="ubp-lookup" className="sr-only">
            UBP identifier
          </label>
          <input
            id="ubp-lookup"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="UBP-XXXXXXXX"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase"
            maxLength={12}
          />
          <Button type="submit">Verify</Button>
        </form>

        <div className="mt-8">
          {loading && <Spinner label="Looking up passport" />}

          {!loading && notFound && (
            <Alert tone="warning" title="No passport found">
              No Universal Business Passport is registered with that identifier. Check the identifier
              and try again. A passport that has been removed will also return this result.
            </Alert>
          )}

          {!loading && error && (
            <Alert tone="error" title="Verification failed">
              {error}
            </Alert>
          )}

          {!loading && result && (
            <div className="space-y-6">
              <Card className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500">Passport holder</p>
                    <p className="mt-1 text-xl font-semibold text-navy-900">{result.displayName}</p>
                    <p className="mt-1 font-mono text-sm text-slate-600">{result.ubpId}</p>
                  </div>
                  <Badge tone={result.currentlyValid ? 'good' : result.suspended ? 'bad' : 'warn'}>
                    {result.currentlyValid
                      ? 'Currently valid'
                      : result.suspended
                        ? 'Suspended'
                        : 'Not currently published'}
                  </Badge>
                </div>

                <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-slate-500">Issued</dt>
                    <dd className="mt-0.5 font-medium text-slate-800">{formatDate(result.issuedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Levels held</dt>
                    <dd className="mt-0.5 font-medium text-slate-800">
                      {held.length} of {result.verification.length}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Public profile</dt>
                    <dd className="mt-0.5">
                      <Link
                        to={`/business/${result.slug}`}
                        className="font-medium text-navy-700 hover:text-navy-900"
                      >
                        View profile
                      </Link>
                    </dd>
                  </div>
                </dl>

                {result.suspended && (
                  <div className="mt-4">
                    <Alert tone="error" title="This passport is suspended">
                      This passport has been suspended by AllCompanies. It is not currently valid.
                      Contact the platform if you believe this is an error.
                    </Alert>
                  </div>
                )}
              </Card>

              <Card className="p-6">
                <h2 className="text-base font-semibold">Verification detail</h2>
                <div className="mt-4">
                  <VerificationPanel entries={result.verification} />
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </Container>
  );
}

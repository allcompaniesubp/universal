/**
 * Homepage.
 *
 * Everything factual on this page is either a description of what the platform
 * does, or is read from the live database. The directory counts are real counts
 * from the published directory; when the directory is empty the page says so
 * rather than showing invented statistics.
 *
 * The discovery sections that belong to later phases are presented as a roadmap
 * with an explicit "not built yet" marker.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type DirectoryResponse } from '../lib/api.ts';
import { Alert, Badge, Button, Card, Container, EmptyState, Spinner } from '../components/ui.tsx';
import { locationLabel } from '../lib/format.ts';

const PLATFORM_PILLARS = [
  {
    title: 'One business identity',
    body: 'A unique UBP identifier, a public profile, a scannable QR code and a digital business card you can download, print or share.',
  },
  {
    title: 'One free business page',
    body: 'A separate public page on AllCompanies describing what you do, with a clean shareable address and search metadata.',
  },
  {
    title: 'One global directory',
    body: 'Be discoverable by buyers searching by name, category and country, and find suppliers and partners in return.',
  },
  {
    title: 'Honest verification',
    body: 'Every verification level states exactly what was checked, by whom, and when. Paying a fee never buys a verification result.',
  },
];

const ROADMAP = [
  { phase: 'Phase 2', label: 'Product & service listings, enquiries, moderation' },
  { phase: 'Phase 3', label: 'Free business resource vault with verified official links' },
  { phase: 'Phase 4', label: 'Business operations toolkit & AI business assistants' },
  { phase: 'Phase 5', label: 'AI employment, jobs & global networking' },
  { phase: 'Phase 6', label: 'E-commerce transactions, cart & checkout' },
  { phase: 'Phase 7', label: 'Embeddable trust widget, analytics & integrations' },
];

export function HomePage() {
  const [directory, setDirectory] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .directory({ page: 1 })
      .then((result) => {
        if (!cancelled) setDirectory(result);
      })
      .catch(() => {
        if (!cancelled) setError('The business directory could not be loaded right now.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <section className="border-b border-slate-200 bg-navy-900 text-white">
        <Container className="py-14 sm:py-20">
          <div className="max-w-3xl">
            <Badge tone="info">
              <span className="text-gold-200">Phase 1 · Core platform live</span>
            </Badge>
            <h1 className="mt-5 text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-5xl">
              The Universal Business Passport
            </h1>
            <p className="mt-5 text-base leading-relaxed text-navy-100 sm:text-lg">
              One business identity. One digital passport. One global marketplace. One AI business
              toolkit. One free business resource network.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-navy-200">
              Register your business, create a free public page, get a unique UBP identifier with a
              scannable QR code and a downloadable digital card, and become discoverable to buyers,
              suppliers and partners worldwide.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register">
                <Button tone="secondary" className="!bg-gold-400 !text-navy-900 hover:!bg-gold-300">
                  Create your free business passport
                </Button>
              </Link>
              <Link to="/discover">
                <Button tone="ghost" className="!text-white hover:!bg-navy-800">
                  Discover businesses
                </Button>
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <Container className="py-12 sm:py-16">
        <section aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="text-xl font-semibold sm:text-2xl">
            How the passport works
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLATFORM_PILLARS.map((pillar) => (
              <Card key={pillar.title} className="p-5">
                <h3 className="text-sm font-semibold text-navy-900">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{pillar.body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="directory-preview" className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="directory-preview" className="text-xl font-semibold sm:text-2xl">
                Businesses on the platform
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {loading
                  ? 'Loading the published directory…'
                  : directory && directory.total > 0
                    ? `${directory.total} published ${directory.total === 1 ? 'business' : 'businesses'} in the directory.`
                    : 'No businesses have been published yet.'}
              </p>
            </div>
            <Link to="/discover" className="text-sm font-medium text-navy-700 hover:text-navy-900">
              Browse the directory →
            </Link>
          </div>

          <div className="mt-6">
            {loading && <Spinner label="Loading directory" />}

            {error && !loading && (
              <Alert tone="warning" title="Directory unavailable">
                {error}
              </Alert>
            )}

            {!loading && !error && directory && directory.items.length === 0 && (
              <EmptyState title="The directory is empty">
                No businesses have published a profile yet. The first published profile will appear
                here. We do not display sample or placeholder businesses.
              </EmptyState>
            )}

            {!loading && !error && directory && directory.items.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {directory.items.map((business) => (
                  <Card key={business.ubpId} className="flex flex-col p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-navy-900">{business.displayName}</h3>
                      <span className="shrink-0 font-mono text-[0.65rem] text-slate-400">
                        {business.ubpId}
                      </span>
                    </div>
                    {business.tagline && (
                      <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{business.tagline}</p>
                    )}
                    {locationLabel(business) && (
                      <p className="mt-2 text-xs text-slate-500">{locationLabel(business)}</p>
                    )}
                    <div className="mt-auto pt-4">
                      <Link
                        to={`/business/${business.slug}`}
                        className="text-sm font-medium text-navy-700 hover:text-navy-900"
                      >
                        View profile →
                      </Link>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="roadmap" className="mt-14">
          <h2 id="roadmap" className="text-xl font-semibold sm:text-2xl">
            What is built, and what is next
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            We would rather be precise than impressive. Phase 1 is complete and running: accounts,
            business profiles, ownership-protected editing, unique UBP identifiers, QR codes, digital
            cards, public business pages and public verification pages. The following are designed
            but not yet built, and no part of this site claims otherwise.
          </p>
          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Planned phases and their scope</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Phase
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Scope
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-4 py-3 font-medium text-slate-900">Phase 1</td>
                  <td className="px-4 py-3 text-slate-600">
                    Accounts, business profiles, UBP identity, QR codes, digital cards, public pages,
                    verification pages
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="good">Built</Badge>
                  </td>
                </tr>
                {ROADMAP.map((item) => (
                  <tr key={item.phase}>
                    <td className="px-4 py-3 font-medium text-slate-900">{item.phase}</td>
                    <td className="px-4 py-3 text-slate-600">{item.label}</td>
                    <td className="px-4 py-3">
                      <Badge tone="neutral">Not built yet</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="trust" className="mt-14">
          <h2 id="trust" className="text-xl font-semibold sm:text-2xl">
            How verification works here
          </h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <p className="text-sm leading-relaxed text-slate-700">
                A verification level is recorded only after the corresponding check has actually been
                performed, and each recorded check states its source, method, date and scope. Phase 1
                records two levels automatically — that a profile exists and is owned by a registered
                account, and that the account holder can receive email at their address. The remaining
                levels require a human reviewer and are shown as “not checked yet” until a reviewer
                acts.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-slate-700">
                Paying a fee never produces a verification level. We do not guarantee solvency,
                trustworthiness, regulatory compliance or future performance, and we do not sell
                positive ratings.
              </p>
              <Link
                to="/passport"
                className="mt-4 inline-block text-sm font-medium text-navy-700 hover:text-navy-900"
              >
                See what each verification level means →
              </Link>
            </Card>
            <Card className="bg-slate-50 p-5">
              <h3 className="text-sm font-semibold text-navy-900">Verify a passport</h3>
              <p className="mt-2 text-sm text-slate-600">
                Every passport has a public verification page showing its real, current status.
              </p>
              <Link to="/verify" className="mt-3 inline-block">
                <Button tone="secondary" fullWidth>
                  Check a UBP identifier
                </Button>
              </Link>
            </Card>
          </div>
        </section>

        <section aria-labelledby="faq" className="mt-14">
          <h2 id="faq" className="text-xl font-semibold sm:text-2xl">
            Frequently asked questions
          </h2>
          <div className="mt-5 space-y-3">
            {[
              {
                q: 'What is the Universal Business Passport?',
                a: 'It is a private digital business identity and membership credential issued by AllCompanies. It gives your business a unique identifier, a public profile page, a QR code and a digital card. It is not a government-issued passport, a statutory licence, a bank card or a government endorsement.',
              },
              {
                q: 'Is it free?',
                a: 'Registration, a business profile, a public page, a UBP identifier, a QR code and a digital card are free. Phase 1 introduces no charges. Paid upgrades, if any, will be introduced later with prices, taxes and renewal terms shown before purchase, and no payment collection exists yet.',
              },
              {
                q: 'Does a paid membership verify my business?',
                a: 'No. Verification levels describe specific checks that have actually been carried out. Paying a fee never produces a verification level, and we do not sell verification outcomes.',
              },
              {
                q: 'Can I edit another business’s profile?',
                a: 'No. Every change is authorised on the server against the account that owns the profile. Changing an identifier in a URL or an API request does not grant access, and a business that is not published is not readable by anyone but its owner.',
              },
              {
                q: 'Which features are not available yet?',
                a: 'Product and service listings, the resource vault, AI assistants, jobs, networking and e-commerce checkout are designed but not built. They are marked as not built throughout the site and will be delivered in the phases listed above.',
              },
            ].map((item) => (
              <details key={item.q} className="group rounded-xl border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-medium text-navy-900 marker:content-['']">
                  <span className="flex items-center justify-between gap-4">
                    {item.q}
                    <span
                      aria-hidden="true"
                      className="text-slate-400 transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-2xl bg-navy-900 p-8 text-center text-white sm:p-12">
          <h2 className="text-xl font-semibold text-white sm:text-2xl">
            Create your free business passport
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-navy-200">
            Register an account, add your business details, and get your unique UBP identifier with a
            QR code and a downloadable card.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/register">
              <Button tone="secondary" className="!bg-gold-400 !text-navy-900 hover:!bg-gold-300">
                Register your business
              </Button>
            </Link>
            <Link to="/signin">
              <Button tone="ghost" className="!text-white hover:!bg-navy-800">
                Sign in
              </Button>
            </Link>
          </div>
        </section>
      </Container>
    </>
  );
}

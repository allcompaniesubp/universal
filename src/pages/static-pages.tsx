/**
 * Informational pages: Passport explanation, About/roadmap, Help, and the
 * placeholders for phases that are not built.
 *
 * The phase placeholders are deliberately explicit: they say what the feature
 * will do and that it does not exist yet, rather than rendering an empty shell
 * that looks like a broken feature.
 */

import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, Container } from '../components/ui.tsx';
import { LEVEL_DEFINITIONS } from '../../shared/verification-levels.ts';

export function PassportPage() {
  return (
    <Container className="py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold sm:text-3xl">The Universal Business Passport</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-700">
          The Universal Business Passport is a private digital business identity and membership
          credential issued by AllCompanies. It gives a business one persistent identity across the
          platform: a unique identifier, a public profile, a scannable QR code and a digital business
          card that can be downloaded, printed or shared.
        </p>

        <Alert tone="warning" title="What this passport is not">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>It is not a government-issued passport or identity document.</li>
            <li>It is not a statutory licence, permit or registration.</li>
            <li>It is not a bank card, credit card or payment instrument of any kind.</li>
            <li>It is not a government endorsement or a certification by any authority.</li>
            <li>
              It is not a guarantee of solvency, trustworthiness, regulatory compliance or future
              performance.
            </li>
          </ul>
        </Alert>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">What the passport includes</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              'A unique UBP identifier, such as UBP-4K7M2XQ9',
              'A public profile page at a clean, shareable address',
              'A QR code that opens the public verification page',
              'A downloadable digital business card (vCard)',
              'A printable passport card',
              'A public verification page showing real status',
              'Per-level verification records with source and date',
              'Privacy controls for contact details',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                <span aria-hidden="true" className="mt-0.5 text-emerald-600">
                  ✓
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Verification levels</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            A level is recorded only after the corresponding check has actually been carried out. Each
            recorded check stores the source, method, date, reviewer or system, and the scope of what
            was checked. An unperformed check is shown as “not checked yet” rather than being hidden.
          </p>

          <div className="mt-5 space-y-3">
            {LEVEL_DEFINITIONS.map((level) => (
              <Card key={level.key} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-navy-900">{level.label}</h3>
                  <Badge tone={level.automaticInPhase1 ? 'good' : 'neutral'}>
                    {level.automaticInPhase1 ? 'Recorded automatically in Phase 1' : 'Requires human review'}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{level.meaning}</p>
                <p className="mt-2 text-xs italic text-slate-500">Scope: {level.scope}</p>
              </Card>
            ))}
          </div>

          <Alert tone="info" title="Paying never buys verification">
            A fee does not produce a verification level, and we do not sell verification outcomes,
            ratings or endorsements.
          </Alert>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">The card design</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            The passport card is designed to read clearly as a membership and identity credential. It
            deliberately avoids the visual language of a payment card: there is no grouped
            sixteen-digit number, no chip contact pattern, no card-network mark and no “valid thru”
            field, and the face of the card states that it is not a payment card. The identifier is
            prefixed <span className="font-mono">UBP-</span> rather than being a bare number.
          </p>
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/register">
            <Button>Create your free business passport</Button>
          </Link>
          <Link to="/verify">
            <Button tone="secondary">Verify a passport</Button>
          </Link>
        </div>
      </div>
    </Container>
  );
}

const ROADMAP_DETAIL = [
  {
    phase: 'Phase 2',
    title: 'Listings and discovery',
    items: [
      'Product and service listings with images, pricing and availability',
      'Enquiries, requests for quotation and supplier enquiries',
      'Saved businesses, comparison and seller dashboards',
      'Moderation, reporting and prohibited-goods policy enforcement',
    ],
  },
  {
    phase: 'Phase 3',
    title: 'Free business resource vault',
    items: [
      'A searchable directory of genuinely free and conditionally free business resources',
      'Official-source links, eligibility rules and access classification',
      'Last-checked and next-review dates, with a user reporting path',
      'Administrator review workflow for material changes',
    ],
  },
  {
    phase: 'Phase 4',
    title: 'Business operations and AI',
    items: [
      'Invoice, quotation, purchase order and catalogue templates',
      'Calculators with stated assumptions',
      'AI business assistants with server-side quotas and cost controls',
      'Business knowledge bases with human approval for consequential actions',
    ],
  },
  {
    phase: 'Phase 5',
    title: 'Employment and networking',
    items: [
      'Employer profiles, job postings and application tracking',
      'Candidate profiles with privacy controls and résumé protection',
      'Supplier, distributor and partner discovery with connection requests',
      'Business messaging with abuse controls',
    ],
  },
  {
    phase: 'Phase 6',
    title: 'E-commerce transactions',
    items: [
      'Cart, checkout and order lifecycle',
      'Payment-provider abstraction with sandbox verification first',
      'Server-side webhook validation before any order is marked paid',
      'Refunds, cancellations and dispute handling',
    ],
  },
  {
    phase: 'Phase 7',
    title: 'Advanced features',
    items: [
      'Embeddable verification widget',
      'Advanced analytics and team memberships',
      'More countries, languages and currencies',
      'Approved integrations',
    ],
  },
];

export function AboutPage() {
  return (
    <Container className="py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold sm:text-3xl">About the platform and its build status</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-700">
          The Universal Business Passport is being built in reviewable phases rather than as one
          large, unreviewed change. This page states exactly what exists today and what does not, so
          nobody has to guess whether a feature is real.
        </p>

        <Card className="mt-8 border-emerald-200 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">Phase 1 — Core platform</h2>
            <Badge tone="good">Built and running</Badge>
          </div>
          <ul className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            {[
              'Registration, sign-in, sign-out and email verification',
              'Password change with session invalidation',
              'Business profiles with ownership enforced server-side',
              'Unique UBP identifiers and validated public addresses',
              'QR codes that resolve to the public verification page',
              'Downloadable digital business card (vCard)',
              'Public business pages with SEO metadata',
              'Public verification pages with real per-level detail',
              'Per-level verification records with source and date',
              'Rate limiting, audit logging and security headers',
              'Database migrations with a documented rollback',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5 text-emerald-600">
                  ✓
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Planned phases</h2>
          <p className="mt-2 text-sm text-slate-600">
            Nothing below is built yet. Each item will be delivered, tested and reported separately.
          </p>
          <div className="mt-5 space-y-4">
            {ROADMAP_DETAIL.map((phase) => (
              <Card key={phase.phase} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-navy-900">
                    {phase.phase} — {phase.title}
                  </h3>
                  <Badge tone="neutral">Not built yet</Badge>
                </div>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                  {phase.items.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </Container>
  );
}

export function HelpPage() {
  return (
    <Container className="py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold sm:text-3xl">Help and support</h1>

        <div className="mt-8 space-y-3">
          {[
            {
              q: 'How do I create a business profile?',
              a: 'Register an account, then choose “Add a business” from your dashboard. Your profile is created as a draft with a unique UBP identifier. You can edit it and publish when you are ready.',
            },
            {
              q: 'Why is my profile not in the directory?',
              a: 'Only published profiles appear in the directory. A draft, unpublished or suspended profile is not visible to visitors and cannot be read by anyone other than its owner.',
            },
            {
              q: 'What does the QR code contain?',
              a: 'It contains only the public verification address for your UBP identifier. It holds no private information and no token, so scanning it reveals your verification status and nothing else.',
            },
            {
              q: 'How do I confirm my email address?',
              a: 'Registration issues a single-use confirmation link that expires after 24 hours. If this deployment has no email provider configured, the link is shown on the registration screen instead, and the platform says plainly that no email was sent.',
            },
            {
              q: 'Can I change my public web address?',
              a: 'Yes, from the business editor. The address must be unique across the platform; if another business already uses it you will be asked to choose a different one.',
            },
            {
              q: 'How do I report a business or a listing?',
              a: 'Reporting and moderation workflows are scheduled for Phase 2, alongside listings. Until then, use the support contact below and include the UBP identifier.',
            },
            {
              q: 'Is my contact information public?',
              a: 'Only if you enable it. Contact details are never shown unless you allow it in your profile, and are never shown while the profile is unpublished.',
            },
          ].map((item) => (
            <details key={item.q} className="group rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-medium text-navy-900">
                <span className="flex items-center justify-between gap-4">
                  {item.q}
                  <span aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-45">
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>

        <Card className="mt-8 p-6">
          <h2 className="text-base font-semibold">Still stuck?</h2>
          <p className="mt-2 text-sm text-slate-600">
            Support contact details and a ticket form will be added with the support module. In the
            meantime, report an issue to the platform operator, including your UBP identifier and the
            page you were using.
          </p>
        </Card>
      </div>
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Phase placeholders
// ---------------------------------------------------------------------------

const PHASE_PLACEHOLDERS: Record<string, { title: string; phase: string; description: string }> = {
  products: {
    title: 'Products',
    phase: 'Phase 2',
    description:
      'Product listings with images, specifications, pricing, currencies, minimum order quantities, shipping origin and seller profiles.',
  },
  services: {
    title: 'Services',
    phase: 'Phase 2',
    description:
      'Service listings with coverage areas, packages, indicative pricing, portfolio examples and booking or enquiry requests.',
  },
  'buy-sell': {
    title: 'Buy & Sell',
    phase: 'Phase 2 and Phase 6',
    description:
      'Requests for quotation, supplier enquiries and purchase-intent requests arrive in Phase 2. Cart, checkout, orders, payment-provider integration, refunds and disputes arrive in Phase 6, once a payment provider is approved and configured.',
  },
  'ai-hub': {
    title: 'AI Business Hub',
    phase: 'Phase 4',
    description:
      'AI business assistants for product descriptions, marketing copy, proposals, quotations, translation and customer support. Each will run server-side with usage quotas and cost controls, and will report a setup error honestly when no AI provider is configured rather than pretending to work.',
  },
  jobs: {
    title: 'AI Employment & Jobs',
    phase: 'Phase 5',
    description:
      'Employer profiles, job postings, candidate profiles, applications and recruitment workflows. AI may help draft job descriptions, but no candidate will be rejected automatically on the basis of protected characteristics or opaque scoring.',
  },
  resources: {
    title: 'Free Business Resources',
    phase: 'Phase 3',
    description:
      'A searchable vault of genuinely free and conditionally free business resources, researched from official providers and governments, each with its access classification, eligibility rules, official link, last-checked date and next-review date.',
  },
  grants: {
    title: 'Grants & Startup Benefits',
    phase: 'Phase 3',
    description:
      'A global opportunity finder for grants, subsidies, competitions, loans and startup credit programmes, distinguishing grants from loans, equity and promotional credits, and never implying that every programme is open to every member.',
  },
  networking: {
    title: 'Global Networking',
    phase: 'Phase 5',
    description:
      'Supplier, distributor, exporter and partner discovery with connection requests, business messaging, requests for quotation and abuse controls. Private contact details are never published without permission.',
  },
  events: {
    title: 'Learning & Events',
    phase: 'Phase 7',
    description:
      'Courses, certifications, webinars and mentorship listings, together with business event and networking-event listings.',
  },
  pricing: {
    title: 'Pricing',
    phase: 'Later phase',
    description:
      'Phase 1 introduces no charges: registration, a business profile, a public page, a UBP identifier, a QR code and a digital card are all free. If paid upgrades are introduced, prices, currency, billing interval, applicable taxes, renewal terms, cancellation terms and the refund policy will be shown before any purchase, and no payment collection exists yet.',
  },
};

export function PhasePlaceholderPage({ feature }: { feature: keyof typeof PHASE_PLACEHOLDERS }) {
  const meta = PHASE_PLACEHOLDERS[feature];
  if (!meta) return null;

  return (
    <Container className="py-12">
      <div className="mx-auto max-w-2xl">
        <Badge tone="neutral">Not built yet</Badge>
        <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">{meta.title}</h1>
        <p className="mt-2 text-sm font-medium text-navy-700">Scheduled for {meta.phase}</p>
        <p className="mt-4 text-base leading-relaxed text-slate-700">{meta.description}</p>

        <Alert tone="info" title="Why this page says nothing is here">
          This page exists so that the navigation matches the product plan, and so that no visitor is
          left guessing whether the feature is broken. It is not built, and the platform does not claim
          otherwise.
        </Alert>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/discover">
            <Button tone="secondary">Browse businesses</Button>
          </Link>
          <Link to="/about">
            <Button tone="ghost">See the full roadmap</Button>
          </Link>
        </div>
      </div>
    </Container>
  );
}

# Universal Business Passport (UBP)

**One business identity. One digital passport. One global marketplace.**

Powered by AllCompanies. This repository is the UBP platform: business identity,
a public business directory, a verifiable passport credential, and the foundation
for the marketplace, resource vault and AI tooling described in the product brief.

---

## Status: Phase 1 complete

Only Phase 1 is implemented. Everything else in the brief is deliberately marked
"not built yet" in the UI rather than mocked up, because a feature that looks
finished but is not is worse than one that is honestly absent.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Accounts, business profiles, UBP identity, QR codes, digital cards, public pages, verification pages | **Built** |
| 2 | Product & service listings, enquiries, moderation | Not built yet |
| 3 | Free business resource vault with verified official links | Not built yet |
| 4 | Business operations toolkit & AI business assistants | Not built yet |
| 5 | AI employment, jobs & global networking | Not built yet |
| 6 | E-commerce transactions, cart & checkout | Not built yet |
| 7 | Embeddable trust widget, analytics & integrations | Not built yet |

### What works today

- Registration, sign-in, sign-out, email verification, password change.
- Business profiles with ownership enforced server-side on every route.
- Unique UBP identifiers (`UBP-XXXXXXXX`), reserved-slug protection.
- Server-rendered SVG QR codes that resolve to the public verification page.
- vCard digital business cards (owner-only).
- Public business micro-pages and a searchable directory.
- Public verification pages showing real, per-level check records.
- Administrator routes gated on a database-read role, with an audit log.

### What is explicitly not implemented

- No payments, cart, checkout, orders, payouts or escrow. `paymentsEnabled` is
  reported as `false` by `/api/config/status`. No payment card field exists
  anywhere in the schema.
- No AI features. `aiToolsEnabled` is `false`.
- No listings, reviews, ratings or messaging. Public pages say so in place.
- No email delivery by default; see [Email delivery](#email-delivery).

---

## Design rules that the code and schema enforce

These are not aspirations in a document. Each one is enforced by a constraint or
a test, and the tests fail if the rule is broken.

1. **A verification level is recorded only after the corresponding check is
   actually performed.** `verification_records` has a `CHECK` constraint listing
   the six valid levels and five valid statuses. Nothing in the codebase writes
   `verified` without a recorded method, source and timestamp.
2. **Every verification record names who or what performed the check.**
   `verification_attribution_present` requires either a reviewer user id or a
   named system. An unattributed record cannot be inserted.
3. **No function grants a level in exchange for payment.** There is no payment
   code in Phase 1, and no verification path accepts a price.
4. **No function defaults an unperformed check to `verified`.** A missing record
   renders as `not_started`, and an expired or revoked record renders as not
   currently held.
5. **Emails are stored lower-cased with a unique index** (`users_email_lowercase`
   plus `users_email_key`), not with `citext`, so no extension is required.
6. **No payment card data is stored.** Phase 6 must add a provider token
   reference, never a PAN or CVV.
7. **Reserved slug words are rejected** so a business can never take a slug that
   collides with an application route such as `/dashboard` or `/api`.
8. **A suspended passport still resolves.** A card printed before suspension must
   not scan as "no such passport", because that is indistinguishable from a
   forged card. The verification page reports it as suspended and not currently
   valid instead.

---

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 19 + TypeScript + Vite | Required by the brief; no server needed to render the SPA shell |
| Styling | Tailwind CSS v4 | Small build, no runtime CSS-in-JS cost |
| API (local) | Express 5 dev server | Fast feedback loop while developing |
| API (production) | Vercel serverless function (`api/index.ts`) | Same router, no second implementation |
| Database | PostgreSQL | `gen_random_uuid()` and `CHECK` constraints do real work here |
| Tests | Vitest | Runs the real router against a real database |

The API router in `server/http/app.ts` is shared by both the dev server and the
serverless entry point, so local behaviour and deployed behaviour cannot drift.

---

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Provide a PostgreSQL database

Any PostgreSQL 13 or newer works, because `gen_random_uuid()` is built in.
Locally:

```bash
docker run --name ubp-pg -e POSTGRES_USER=ubp -e POSTGRES_PASSWORD=ubptest \
  -e POSTGRES_DB=ubp -p 55432:5432 -d postgres:16
```

For production, a Neon **pooled** connection string is the intended default
(the host contains `-pooler`), because serverless functions open short-lived
connections.

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in values. Names only, never commit values:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NODE_ENV` | No | `production` enables Secure cookies |
| `PUBLIC_BASE_URL` | No | Absolute origin embedded in QR codes and share links |
| `SESSION_COOKIE_NAME` | No | Defaults to `ubp_session` |
| `EMAIL_TRANSPORT` | No | `none` (default) or `console` |
| `EMAIL_FROM` | No | From address when a transport is configured |
| `TEST_DATABASE_URL` | Tests | Separate database for the test suite |

### 4. Migrate and run

```bash
npm run migrate
npm run dev
```

`npm run dev` starts the API and the Vite dev server together. Vite proxies
`/api` to the API process, so one origin serves both.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | API + web dev servers together |
| `npm run build` | Production frontend build |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Full test suite (needs `TEST_DATABASE_URL`) |
| `npm run migrate` | Apply pending migrations (idempotent) |
| `npm run grant:admin` | Promote a user to admin (see below) |

---

## Database migrations

Migrations live in `db/migrations/` and are applied in filename order, recorded
in `schema_migrations`. Re-running is safe: applied versions are skipped.

```bash
npm run migrate
```

### Rollback

`db/rollback/0001_phase1_core_down.sql` reverses the Phase 1 schema.

> **Warning:** the rollback destroys all Phase 1 data, including accounts,
> business profiles and audit history. Take a backup first. It exists so a
> deployment can be reversed deliberately, not as a routine operation.

```bash
psql "$DATABASE_URL" -f db/rollback/0001_phase1_core_down.sql
```

After a rollback, delete the matching row from `schema_migrations` if you intend
to re-apply the migration, because the script deliberately leaves that table in
place.

### Backup and recovery

Use the database provider's point-in-time recovery. For a manual logical backup:

```bash
pg_dump "$DATABASE_URL" > ubp-backup.sql
```

Restore into a fresh database, then run `npm run migrate` to confirm the schema
matches the expected version.

---

## Granting administrator access

There is **no API route that grants a role**, and no client-supplied value is ever
trusted as a role. The role is read from the `users` table on every request, so
demotion takes effect on the next request without needing to invalidate a session.

```bash
DATABASE_URL="postgres://..." npm run grant:admin -- user@example.com
```

Run this against the intended database only. Every administrative action is
written to `audit_log`.

---

## Email delivery

Email delivery is **not configured by default**, and the API says so rather than
pretending a message was sent. Registration still succeeds; the response reports
`delivered: false` with `reason: "not_configured"`.

- `EMAIL_TRANSPORT=none` (default): no email is sent. In non-production, the
  verification link is returned in the API response so local flows are testable.
- `EMAIL_TRANSPORT=console`: the verification link is written to the server log.
  Development only.

A real transport (a transactional email provider) is Phase 2 work. It needs a
provider account and a secret, so it is not enabled here.

---

## Testing

The suite runs the real router against a real PostgreSQL database. There are no
mocks for the database or the HTTP layer, because the risks worth testing here
(ownership checks, constraint enforcement, session handling) only exist in the
real stack.

```bash
createdb ubp_test
TEST_DATABASE_URL="postgres://ubp:ubptest@127.0.0.1:55432/ubp_test" npm test
```

`TEST_DATABASE_URL` is truncated between tests. Never point it at production data.

| File | Covers |
| --- | --- |
| `tests/domain.test.ts` | Slug generation and validation, verification-level definitions |
| `tests/auth.test.ts` | Registration, sign-in, sessions, rate limiting, password change |
| `tests/business.test.ts` | Business CRUD, slug rules, ownership enforcement (IDOR) |
| `tests/passport.test.ts` | UBP identity, QR routes, vCard, verification records |
| `tests/qr.test.ts` | QR module matrix compared against an independent encode |
| `tests/admin.test.ts` | Admin route protection and privilege-escalation attempts |

The QR test is worth calling out: asserting that an endpoint returns `<svg` proves
nothing about whether a code scans. `tests/qr.test.ts` rebuilds the module matrix
from the rendered SVG and compares it, module for module, against an independent
encode of the expected payload.

---

## Deployment (Vercel)

`vercel.json` builds the frontend to `dist/` and rewrites everything except
`/api/*` to `index.html`, so SPA deep links work while API routes reach the
serverless function.

Set `DATABASE_URL` and `PUBLIC_BASE_URL` in the Vercel project environment, then
run the migration against the production database before the first deploy.

`PUBLIC_BASE_URL` matters more than it looks: QR codes printed on physical cards
embed the origin. Set it to the canonical production origin so a card printed
today still resolves after a domain change.

### Security headers

`vercel.json` sets `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Strict-Transport-Security` and `Permissions-Policy`. A
Content-Security-Policy is **not** yet set, because the correct policy depends on
the final asset origins and any later integrations; adding a wrong one would
break the app. This is tracked as outstanding work below.

---

## Security notes

Implemented:

- Session tokens are stored only as a SHA-256 hash, so a database read does not
  yield a usable cookie.
- Passwords are hashed with `scrypt` and compared in constant time.
- Every protected route reads the caller's role and ownership from the database
  on each request; nothing is trusted from the client.
- Login attempts are rate limited, with per-account lockout after repeated
  failures.
- Input is validated with Zod schemas on the server, independently of any
  client-side validation.
- Audit entries store a hashed IP, never a raw address.
- Private values (contact details, internal UUIDs) are omitted from public
  responses rather than hidden in the UI.

Outstanding, and requiring review before a public launch:

- **No Content-Security-Policy.** See above.
- **No legal review.** The terms of service, privacy policy, seller terms,
  refund policy, acceptable-use policy and complaint procedure have not been
  drafted or reviewed. Privacy, consumer-protection, marketplace, tax and
  e-commerce obligations vary by jurisdiction and need professional review
  before launch. Nothing in this repository should be read as a compliance claim.
- **No document storage.** Verification levels that require document review have
  no upload path yet, so they cannot be granted. This is intentional: the level
  exists in the schema and is reported honestly as `not_started`.
- **No backup automation.** Recovery relies on the database provider.
- **No verification of email deliverability** beyond the token flow, because no
  transport is configured.

---

## Repository layout

```
api/                  Vercel serverless entry point
db/migrations/        Forward migrations
db/rollback/          Reverse migrations
scripts/              dev launcher, migrate, grant-admin
server/
  config.ts           Environment loading and validation
  db.ts               Connection pool and query helpers
  dev-server.ts       Express dev server
  http/               Router, cookies, auth context, errors, rate limiting
  routes/             auth, business, admin route handlers
  services/           auth, business, qr (vCard and SVG rendering)
  domain/             slug rules, verification level definitions
  validation/         Zod request schemas
shared/               Code imported by both browser and server
src/                  React application
tests/                Vitest suites
```

`shared/verification-levels.ts` is the single source of truth for what each
verification level means. The browser and the server import the same file, so the
wording a business sees in its dashboard cannot drift from what the public
verification page asserts.

---

## Legal notice

The Universal Business Passport is a private digital business identity and
membership credential issued by AllCompanies. It is **not** a government-issued
passport, a statutory licence, a bank card, a credit facility, or a government
endorsement. Verification levels describe specific checks that were performed;
they are not a guarantee of solvency, trustworthiness or regulatory compliance.

## License

Not yet chosen. Add a license before accepting external contributions.

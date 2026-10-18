# AGENTS.md — UBP (Universal Business Passport)

Repository-specific knowledge for future sessions. Keep this file short and factual.

## What this is

`allcompaniesubp/universal` — the Universal Business Passport platform: business
identity, profiles, verification, and (in later phases) listings, marketplace,
AI tools, jobs and a resource directory.

This is a **greenfield** repo. It is deliberately *not* `Nextlevelcryptocoin/allcompanies`.

## Stack

- React 19 + TypeScript + Vite + Tailwind v4 (client, `src/`)
- One API router (`server/http/`) shared by two adapters:
  - `server/dev-server.ts` (Express, local + self-hosted)
  - `api/index.ts` (Vercel serverless function)
- PostgreSQL via `pg`. Migrations in `db/migrations/`, rollback in `db/rollback/`.

Because both adapters use the same router, local and deployed behaviour cannot
drift. Change the router, not the adapters, when adding routes.

## Commands

```bash
npm run typecheck              # tsc --noEmit
npm test                       # vitest run (needs a real Postgres)
npm run build                  # vite build
npm run migrate                # apply db/migrations (idempotent)
npm run dev                    # API + web together
npm run grant:admin -- <email> # role assignment
```

Tests need a database. `TEST_DATABASE_URL` is required; the suite refuses to run
without it so a missing database can never be mistaken for a passing run.

```bash
TEST_DATABASE_URL="postgresql://user@127.0.0.1:5433/ubp_test" npm test
```

## Conventions

- **No mocks in tests.** The suite drives the real router against real Postgres.
  The risks worth testing here (ownership checks, constraint enforcement, session
  handling, CSRF) only exist in the real stack.
- **Honest states.** A feature that is not built reports as not built. Never
  fabricate a user, business, review, transaction, certification or verification
  result. `GET /api/config/status` reports what is actually enabled.
- **A verification level is only `verified` after the check ran.** The database
  enforces this: `verification_records` constrains the levels and statuses, and
  requires a reviewer id *or* a named system on every row.
- **Server-side authorisation on every protected route.** `requireOwnedBusiness`
  is the single choke point for business ownership. Never trust a client-supplied
  role or id.
- **Configuration, not request headers, for origins.** `resolvePublicOrigin`
  reads validated config only. `Host` / `X-Forwarded-Host` are attacker-controlled
  and must never reach a generated link or a CSRF check.
- **CSRF is unconditional.** Enforced centrally in `dispatch`. There is
  intentionally no bypass flag; do not add one.
- **Client IP.** Only a platform-set header is trusted (`TRUSTED_IP_HEADER`,
  auto-detected on Vercel). `X-Forwarded-For` is *appended to* by most proxies,
  so its first entry is spoofable — never trust it without a known overwriting edge.
- **Secrets** live only in server-side env vars. `.env.example` documents names
  only. Never commit a value, and never print one in a report.

## Deployment notes

- `vercel.json` rewrites `/api/:path*` to `/api/index` **before** the SPA
  catch-all, so nested API paths (e.g. `/api/businesses/:id/qr.svg`) reach the
  function. Order matters: a route added under `/api` must not be shadowed by
  the `index.html` rewrite.
- `PUBLIC_BASE_URL` must be the canonical production origin **before any QR code
  is printed** — printed cards embed the origin permanently.

## Known gaps (do not claim otherwise)

- No Content-Security-Policy.
- No legal documents drafted (terms, privacy, seller terms, refunds). No
  compliance claim is made anywhere.
- No document storage, so document-review verification levels cannot be granted.
- No backup automation; no licence chosen.
- Phase 6 payment work must add a provider token reference only — never a PAN
  or CVV, and never treat a browser redirect as payment confirmation.

## Branch / PR practice

- Work on a feature branch. Do not push to `main`.
- Do not merge, deploy to production, or change DNS without explicit approval.

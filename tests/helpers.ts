/**
 * Test harness.
 *
 * Tests run against a real PostgreSQL database and drive the real HTTP router,
 * so the code exercised here is the same code that runs in production. There are
 * no mocks of the database, the password hasher or the router.
 *
 * Required environment:
 *   TEST_DATABASE_URL  a database that can be dropped and recreated by the suite
 *
 * If TEST_DATABASE_URL is not set, the suite fails loudly rather than skipping,
 * so a missing database can never be mistaken for a passing run.
 */

import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingHttpHeaders } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL (or DATABASE_URL) must point at a PostgreSQL database to run the test suite.',
    );
  }
  return url;
}

/** Applies the Phase 1 schema to a fresh database. */
export async function resetDatabase(): Promise<void> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    // Dropped in dependency order so foreign keys do not block the reset.
    await client.query(`
      DROP TABLE IF EXISTS audit_log CASCADE;
      DROP TABLE IF EXISTS verification_records CASCADE;
      DROP TABLE IF EXISTS businesses CASCADE;
      DROP TABLE IF EXISTS email_verification_tokens CASCADE;
      DROP TABLE IF EXISTS sessions CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS schema_migrations CASCADE;
      DROP FUNCTION IF EXISTS set_updated_at() CASCADE;
    `);
    const sql = await readFile(
      join(here, '..', 'db', 'migrations', '0001_phase1_core.sql'),
      'utf8',
    );
    await client.query(sql);
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Request helper
// ---------------------------------------------------------------------------

export interface TestResponse<T = unknown> {
  status: number;
  body: T;
  /** Raw Set-Cookie strings, so cookie attributes can be asserted. */
  setCookie: string[];
  /** Parsed cookie name/value pairs for chaining requests. */
  cookies: Record<string, string>;
  headers: Record<string, string>;
}

export class TestClient {
  private cookieJar: Record<string, string> = {};

  /**
   * `ip` identifies this client to the rate limiter. Each test client gets its
   * own address by default so that one test's requests do not consume another
   * test's quota; a test that exercises the limiter itself passes a fixed value.
   */
  constructor(
    private readonly router: Awaited<ReturnType<typeof buildTestRouter>>,
    private readonly ip: string = randomTestIp(),
  ) {}

  /** Sends a request through the real router, carrying any cookies set so far. */
  async request<T = unknown>(
    method: string,
    path: string,
    options: { body?: unknown; headers?: IncomingHttpHeaders; cookies?: Record<string, string> } = {},
  ): Promise<TestResponse<T>> {
    const cookieHeader = Object.entries({ ...this.cookieJar, ...options.cookies })
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join('; ');

    const { createRequest } = await import('../server/http/router.ts');
    const apiRequest = createRequest({
      method,
      url: path,
      headers: {
        host: 'localhost:5173',
        'content-type': 'application/json',
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...options.headers,
      },
      body: options.body,
      ip: this.ip,
    });

    const response = await this.router.dispatch(apiRequest);

    const setCookie: string[] = [];
    const cookies: Record<string, string> = {};
    for (const cookie of response.cookies ?? []) {
      const { serialiseCookie } = await import('../server/http/cookies.ts');
      const serialised = serialiseCookie(cookie.name, cookie.value, cookie.options);
      setCookie.push(serialised);
      if (cookie.options.maxAgeSeconds === 0 || cookie.value === '') {
        delete this.cookieJar[cookie.name];
      } else {
        this.cookieJar[cookie.name] = cookie.value;
        cookies[cookie.name] = cookie.value;
      }
    }

    return {
      status: response.status,
      body: response.body as T,
      setCookie,
      cookies,
      headers: response.headers ?? {},
    };
  }

  get<T = unknown>(path: string, options?: { headers?: IncomingHttpHeaders }) {
    return this.request<T>('GET', path, options ?? {});
  }

  post<T = unknown>(path: string, body?: unknown, options?: { headers?: IncomingHttpHeaders }) {
    return this.request<T>('POST', path, { ...(options ?? {}), body });
  }

  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, { body });
  }

  /** Forgets all cookies, simulating a fresh browser. */
  clearCookies(): void {
    this.cookieJar = {};
  }
}

/**
 * Builds the application router with a test configuration.
 * `PUBLIC_BASE_URL` is pinned so QR payload assertions are deterministic.
 */
export async function buildTestRouter() {
  const { resetConfig, setConfigForTesting } = await import('../server/config.ts');
  const { closePool } = await import('../server/db.ts');
  const { resetRateLimits } = await import('../server/http/rate-limit.ts');

  // A fresh pool must pick up the test connection string.
  await closePool();
  resetConfig();
  setConfigForTesting({
    databaseUrl: testDatabaseUrl(),
    nodeEnv: 'test',
    isProduction: false,
    publicBaseUrl: 'https://ubp.test',
    sessionCookieName: 'ubp_session',
    sessionTtlDays: 14,
    emailTransport: 'none',
    emailFrom: null,
  });
  resetRateLimits();

  const { buildRouter, dispatch } = await import('../server/http/app.ts');
  const router = buildRouter();

  return {
    dispatch: (request: Awaited<ReturnType<typeof import('../server/http/router.ts')['createRequest']>>) =>
      dispatch(router, request, { isProduction: false }),
  };
}

export async function createTestClient(options: { ip?: string } = {}): Promise<TestClient> {
  const router = await buildTestRouter();
  return new TestClient(router, options.ip ?? randomTestIp());
}

/** A distinct test IP per client, so rate-limit buckets do not bleed between tests. */
let ipCounter = 0;
function randomTestIp(): string {
  ipCounter += 1;
  const third = Math.floor(ipCounter / 250) % 250;
  const fourth = (ipCounter % 250) + 1;
  return `198.51.${third}.${fourth}`;
}

/** A valid password that satisfies the minimum length rule. */
export const VALID_PASSWORD = 'correct-horse-battery-staple';

/**
 * Registers a user, confirms their email address, and signs in.
 *
 * Registration deliberately does not create a session, so any test that needs to
 * make an authenticated request must call this rather than `registerUser`.
 */
export async function registerAndSignIn(
  client: TestClient,
  overrides: Partial<{ email: string; password: string; fullName: string }> = {},
): Promise<RegisteredUser> {
  const user = await registerUser(client, overrides);
  if (user.verificationToken) {
    await client.post('/api/auth/verify-email', { token: user.verificationToken });
  }
  const login = await client.post('/api/auth/login', {
    email: user.email,
    password: user.password,
  });
  if (login.status !== 200) {
    throw new Error(`Sign-in failed with status ${login.status}: ${JSON.stringify(login.body)}`);
  }
  return user;
}

let emailCounter = 0;

/** Unique email per call, so tests do not collide on the unique index. */
export function uniqueEmail(prefix = 'owner'): string {
  emailCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${emailCounter}@example.test`;
}

export interface RegisteredUser {
  email: string;
  password: string;
  userId: string;
  /** The verification link token, available because email transport is 'none'. */
  verificationToken: string | null;
}

/** Registers a user and returns the identifiers a test needs. */
export async function registerUser(
  client: TestClient,
  overrides: Partial<{ email: string; password: string; fullName: string }> = {},
): Promise<RegisteredUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? VALID_PASSWORD;

  const response = await client.post<{
    user: { id: string };
    emailVerification: { delivered: boolean; verificationUrl?: string };
  }>('/api/auth/register', {
    email,
    password,
    fullName: overrides.fullName ?? 'Test Owner',
  });

  if (response.status !== 201) {
    throw new Error(`Registration failed with status ${response.status}: ${JSON.stringify(response.body)}`);
  }

  let verificationToken: string | null = null;
  const url = response.body.emailVerification.verificationUrl;
  if (url) {
    const match = /token=([^&]+)/.exec(url);
    verificationToken = match?.[1] ? decodeURIComponent(match[1]) : null;
  }

  return { email, password, userId: response.body.user.id, verificationToken };
}

/** Registers, verifies email, signs in, and creates a business. Returns everything. */
export async function createBusinessFixture(
  client: TestClient,
  businessOverrides: Record<string, unknown> = {},
): Promise<{
  user: RegisteredUser;
  businessId: string;
  ubpId: string;
  slug: string;
}> {
  const user = await registerUser(client);
  if (user.verificationToken) {
    await client.post('/api/auth/verify-email', { token: user.verificationToken });
  }

  // Registration does not create a session, so the client must sign in before
  // any authenticated write.
  const login = await client.post('/api/auth/login', {
    email: user.email,
    password: user.password,
  });
  if (login.status !== 200) {
    throw new Error(`Sign-in failed with status ${login.status}: ${JSON.stringify(login.body)}`);
  }

  const slug = (businessOverrides.slug as string | undefined) ?? `suite-co-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000)}`;

  const response = await client.post<{ business: { id: string; ubpId: string; slug: string } }>(
    '/api/businesses',
    {
      displayName: 'Test Company',
      slug,
      tagline: 'A business used by the automated test suite.',
      description: 'Created by the integration test suite to exercise real code paths.',
      category: 'Testing',
      countryCode: 'IN',
      ...businessOverrides,
    },
  );

  if (response.status !== 201) {
    throw new Error(`Business creation failed with status ${response.status}: ${JSON.stringify(response.body)}`);
  }

  return {
    user,
    businessId: response.body.business.id,
    ubpId: response.body.business.ubpId,
    slug: response.body.business.slug,
  };
}

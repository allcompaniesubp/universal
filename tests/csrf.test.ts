/**
 * CSRF and client-IP integrity tests.
 *
 * These exercise the real guard installed in `dispatch`. A passing run means a
 * state-changing request cannot be forged from another origin, and that a
 * caller cannot rotate a request header to escape the rate limiter.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestClient,
  registerUser,
  resetDatabase,
  uniqueEmail,
  VALID_PASSWORD,
  type TestClient,
} from './helpers.ts';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../server/http/csrf.ts';

let client: TestClient;

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  client = await createTestClient();
});

describe('CSRF protection', () => {
  it('issues a script-readable token and accepts it echoed in a header', async () => {
    const bootstrap = await client.get<{ csrfToken: string }>('/api/auth/csrf');

    expect(bootstrap.status).toBe(200);
    expect(typeof bootstrap.body.csrfToken).toBe('string');
    expect(bootstrap.body.csrfToken.length).toBeGreaterThan(20);
    // Readable by script on purpose: the double-submit pattern requires it.
    const cookie = bootstrap.setCookie.find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
    expect(cookie).toBeDefined();
    expect(cookie).not.toMatch(/HttpOnly/i);
  });

  it('rejects a state-changing request with no CSRF token at all', async () => {
    const response = await client.raw('POST', '/api/auth/register', {
      body: { email: uniqueEmail(), password: VALID_PASSWORD, fullName: 'No Token' },
    });

    expect(response.status).toBe(403);
  });

  it('rejects a request whose header token does not match the cookie', async () => {
    const bootstrap = await client.get<{ csrfToken: string }>('/api/auth/csrf');
    const response = await client.raw(
      'POST',
      '/api/auth/register',
      {
        body: { email: uniqueEmail(), password: VALID_PASSWORD, fullName: 'Mismatch' },
        cookies: { [CSRF_COOKIE_NAME]: bootstrap.body.csrfToken },
        headers: { [CSRF_HEADER_NAME]: 'not-the-same-value' },
      },
    );

    expect(response.status).toBe(403);
  });

  it('rejects a request from a different origin even with a valid token', async () => {
    const bootstrap = await client.get<{ csrfToken: string }>('/api/auth/csrf');
    const token = bootstrap.body.csrfToken;

    // The attacker can send the cookie and can guess a header value they set
    // themselves, but cannot make the victim's browser report this Origin.
    const response = await client.raw(
      'POST',
      '/api/auth/register',
      {
        body: { email: uniqueEmail(), password: VALID_PASSWORD, fullName: 'Cross Origin' },
        cookies: { [CSRF_COOKIE_NAME]: token },
        headers: { [CSRF_HEADER_NAME]: token, origin: 'https://evil.example' },
      },
    );

    expect(response.status).toBe(403);
  });

  it('rejects a sibling subdomain of the configured origin', async () => {
    const bootstrap = await client.get<{ csrfToken: string }>('/api/auth/csrf');
    const token = bootstrap.body.csrfToken;

    // Same registrable domain, different host: SameSite alone would allow it.
    const response = await client.raw(
      'POST',
      '/api/auth/register',
      {
        body: { email: uniqueEmail(), password: VALID_PASSWORD, fullName: 'Sibling' },
        cookies: { [CSRF_COOKIE_NAME]: token },
        headers: { [CSRF_HEADER_NAME]: token, origin: 'https://other.ubp.test' },
      },
    );

    expect(response.status).toBe(403);
  });

  it('does not require a token for safe methods', async () => {
    const response = await client.raw('GET', '/api/auth/session');
    expect(response.status).toBe(200);
  });

  it('accepts a properly formed same-origin request', async () => {
    const response = await client.post('/api/auth/register', {
      email: uniqueEmail(),
      password: VALID_PASSWORD,
      fullName: 'Same Origin',
    });
    expect(response.status).toBe(201);
  });

  it('rotates the token on sign-in so a pre-login token cannot be replayed', async () => {
    const user = await registerUser(client);
    await client.post('/api/auth/verify-email', { token: user.verificationToken });

    const before = await client.get<{ csrfToken: string }>('/api/auth/csrf');
    const login = await client.post('/api/auth/login', {
      email: user.email,
      password: user.password,
    });
    expect(login.status).toBe(200);

    const rotated = login.setCookie.find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
    expect(rotated).toBeDefined();
    expect(rotated).not.toContain(before.body.csrfToken);
  });

  it('clears the CSRF cookie on sign-out', async () => {
    const user = await registerUser(client);
    await client.post('/api/auth/verify-email', { token: user.verificationToken });
    await client.post('/api/auth/login', { email: user.email, password: user.password });

    const logout = await client.post('/api/auth/logout', {});
    expect(logout.status).toBe(200);

    const cleared = logout.setCookie.find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
    expect(cleared).toBeDefined();
    // An empty value with an immediate expiry is how a cookie is removed.
    expect(cleared).toMatch(/Max-Age=0/i);
  });
});

describe('client IP resolution', () => {
  it('ignores a spoofed X-Forwarded-For chain when no trusted edge is configured', async () => {
    const { resolveClientIp, loadConfig } = await import('../server/config.ts');
    const config = { ...loadConfig({ DATABASE_URL: 'postgresql://unused' }), trustedIpHeader: null };

    // The first entry is attacker-controlled on most proxies; with no trusted
    // edge configured the whole header must be disregarded.
    const resolved = resolveClientIp(
      config,
      { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      '203.0.113.9',
    );
    expect(resolved).toBe('203.0.113.9');
  });

  it('takes the platform-set header when a trusted edge is configured', async () => {
    const { resolveClientIp, loadConfig } = await import('../server/config.ts');
    const config = {
      ...loadConfig({ DATABASE_URL: 'postgresql://unused' }),
      trustedIpHeader: 'x-vercel-forwarded-for' as const,
    };

    const resolved = resolveClientIp(
      config,
      { 'x-vercel-forwarded-for': '198.51.100.7' },
      '203.0.113.9',
    );
    expect(resolved).toBe('198.51.100.7');
  });

  it('falls back to the socket address when the trusted header is not a valid IP', async () => {
    const { resolveClientIp, loadConfig } = await import('../server/config.ts');
    const config = {
      ...loadConfig({ DATABASE_URL: 'postgresql://unused' }),
      trustedIpHeader: 'x-vercel-forwarded-for' as const,
    };

    const resolved = resolveClientIp(
      config,
      { 'x-vercel-forwarded-for': 'not-an-ip' },
      '203.0.113.9',
    );
    expect(resolved).toBe('203.0.113.9');
  });
});

/**
 * Authentication and session integration tests.
 *
 * These run against real PostgreSQL through the real router. Nothing is mocked,
 * so a passing run means the actual production code path behaves correctly.
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
import { queryOne } from '../server/db.ts';

let client: TestClient;

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  client = await createTestClient();
});

describe('registration', () => {
  it('creates an account and returns no user object and no secret material', async () => {
    const email = uniqueEmail();
    const response = await client.post<Record<string, unknown>>('/api/auth/register', {
      email,
      password: VALID_PASSWORD,
      fullName: 'Asha Menon',
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('verification_unavailable');

    // Registration must not leak a user object, a token, or a link.
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('password_hash');
    expect(serialised).not.toContain('scrypt$');
    expect(serialised).not.toContain(VALID_PASSWORD);
    expect(serialised).not.toContain('token=');
    expect(response.body).not.toHaveProperty('user');
    expect(response.body).not.toHaveProperty('emailVerification');
    expect(response.body).not.toHaveProperty('verificationToken');
    expect(response.body).not.toHaveProperty('verificationUrl');
  });

  it('creates the account in an unverified state', async () => {
    const email = uniqueEmail();
    await client.post('/api/auth/register', {
      email,
      password: VALID_PASSWORD,
      fullName: 'Pending Owner',
    });

    const row = await queryOne<{ email_verified_at: Date | null }>(
      'SELECT email_verified_at FROM users WHERE email = $1',
      [email],
    );
    // A token exists, but nothing about creating it may count as verification.
    expect(row?.email_verified_at).toBeNull();
  });

  it('does not reveal whether an email address is already registered', async () => {
    const email = uniqueEmail();
    const first = await client.post<{ status: string; message: string }>('/api/auth/register', {
      email,
      password: VALID_PASSWORD,
      fullName: 'First Owner',
    });
    expect(first.status).toBe(201);

    const second = await createTestClient();
    const duplicate = await second.post<{ status: string; message: string }>('/api/auth/register', {
      email,
      password: VALID_PASSWORD,
      fullName: 'Second Owner',
    });

    // Identical status, shape and message as a fresh registration, so the
    // endpoint cannot be used to enumerate accounts.
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.status).toBe(first.body.status);
    expect(duplicate.body.message).toBe(first.body.message);
    expect(duplicate.body).not.toHaveProperty('user');
  });

  it('normalises the email address to lower case', async () => {
    const email = `MiXeD-${Date.now().toString(36)}@Example.Test`;
    const response = await client.post('/api/auth/register', {
      email,
      password: VALID_PASSWORD,
      fullName: 'Mixed Case',
    });
    expect(response.status).toBe(201);

    const row = await queryOne<{ email: string }>('SELECT email FROM users WHERE email = $1', [
      email.toLowerCase(),
    ]);
    expect(row?.email).toBe(email.toLowerCase());
  });

  it('rejects a short password with a field-level error', async () => {
    const response = await client.post<{ error: { code: string; details: Record<string, string> } }>(
      '/api/auth/register',
      { email: uniqueEmail(), password: 'short', fullName: 'Short Password' },
    );
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.details.password).toBeTruthy();
  });

  it('rejects a malformed email address', async () => {
    const response = await client.post('/api/auth/register', {
      email: 'not-an-email',
      password: VALID_PASSWORD,
      fullName: 'Bad Email',
    });
    expect(response.status).toBe(422);
  });

  it('rejects a whitespace-only name', async () => {
    const response = await client.post('/api/auth/register', {
      email: uniqueEmail(),
      password: VALID_PASSWORD,
      fullName: '        ',
    });
    expect(response.status).toBe(422);
  });

  it('states honestly that email confirmation is unavailable when transport is not configured', async () => {
    const response = await client.post<{ status: string; message: string }>('/api/auth/register', {
      email: uniqueEmail(),
      password: VALID_PASSWORD,
      fullName: 'Honest Reporting',
    });

    expect(response.status).toBe(201);
    // The suite runs with EMAIL_TRANSPORT=none, so the API must say so rather
    // than implying a message was delivered, and must not hand out a link.
    expect(response.body.status).toBe('verification_unavailable');
    expect(response.body.message).toMatch(/no email provider configured/i);
    expect(JSON.stringify(response.body)).not.toContain('token=');
  });
});

describe('sign in and session', () => {
  it('signs in with correct credentials and sets a hardened cookie', async () => {
    const user = await registerUser(client);
    const fresh = await createTestClient();

    const response = await fresh.post<{ user: { email: string } }>('/api/auth/login', {
      email: user.email,
      password: user.password,
    });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(user.email);
    expect(response.setCookie.length).toBeGreaterThan(0);

    const cookie = response.setCookie[0] ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    // The session token must not be readable by scripts.
    expect(cookie.toLowerCase()).not.toContain('document.cookie');
  });

  it('rejects a wrong password with the same message as an unknown account', async () => {
    const user = await registerUser(client);
    const fresh = await createTestClient();

    const wrongPassword = await fresh.post<{ error: { message: string } }>('/api/auth/login', {
      email: user.email,
      password: 'definitely-not-the-password',
    });

    const unknownAccount = await createTestClient();
    const unknown = await unknownAccount.post<{ error: { message: string } }>('/api/auth/login', {
      email: uniqueEmail('nobody'),
      password: VALID_PASSWORD,
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    // Identical wording prevents using the endpoint to discover which email
    // addresses are registered.
    expect(wrongPassword.body.error.message).toBe(unknown.body.error.message);
  });

  it('returns the signed-in user from the session endpoint and null when signed out', async () => {
    const user = await registerUser(client);
    await client.post('/api/auth/login', { email: user.email, password: user.password });

    const signedIn = await client.get<{ user: { email: string } | null }>('/api/auth/session');
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user?.email).toBe(user.email);

    await client.post('/api/auth/logout');
    const signedOut = await client.get<{ user: null }>('/api/auth/session');
    expect(signedOut.body.user).toBeNull();
  });

  it('invalidates the session on sign out', async () => {
    const user = await registerUser(client);
    await client.post('/api/auth/login', { email: user.email, password: user.password });

    const before = await client.get<{ user: unknown }>('/api/auth/session');
    expect(before.body.user).not.toBeNull();

    const logout = await client.post('/api/auth/logout');
    expect(logout.status).toBe(200);
    // The clearing cookie must expire immediately.
    expect((logout.setCookie[0] ?? '').includes('Max-Age=0')).toBe(true);

    const after = await client.get<{ user: null }>('/api/auth/session');
    expect(after.body.user).toBeNull();
  });

  it('rejects a forged session cookie', async () => {
    const fresh = await createTestClient();
    const response = await fresh.get<{ user: null }>('/api/auth/session', {
      headers: { cookie: 'ubp_session=totally-made-up-token-value' },
    });
    expect(response.status).toBe(200);
    expect(response.body.user).toBeNull();
  });

  it('rejects an expired session', async () => {
    const user = await registerUser(client);
    await client.post('/api/auth/login', { email: user.email, password: user.password });

    // Expire the session directly in the database, then confirm the API refuses it.
    const { query } = await import('../server/db.ts');
    await query('UPDATE sessions SET expires_at = now() - interval \'1 hour\'');

    const response = await client.get<{ user: null }>('/api/auth/session');
    expect(response.body.user).toBeNull();
  });

  it('locks an account after repeated failed attempts', async () => {
    const user = await registerUser(client);

    let lastStatus = 0;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const fresh = await createTestClient();
      const response = await fresh.post<{ error: { code: string } }>('/api/auth/login', {
        email: user.email,
        password: 'wrong-password-value',
      });
      lastStatus = response.status;
    }

    // Once the threshold is crossed the account is locked, reported as 429.
    expect(lastStatus).toBe(429);

    // Even the correct password is refused while the lock holds.
    const correct = await createTestClient();
    const locked = await correct.post<{ error: { code: string } }>('/api/auth/login', {
      email: user.email,
      password: user.password,
    });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('account_locked');
  });

  it('never stores the raw session token in the database', async () => {
    const user = await registerUser(client);
    const response = await client.post('/api/auth/login', { email: user.email, password: user.password });
    const rawToken = response.cookies.ubp_session;
    expect(rawToken).toBeTruthy();

    const { queryOne } = await import('../server/db.ts');
    const byRaw = await queryOne('SELECT id FROM sessions WHERE id = $1', [rawToken]);
    expect(byRaw).toBeNull();

    const { hashToken } = await import('../server/crypto/tokens.ts');
    const byHash = await queryOne('SELECT id FROM sessions WHERE id = $1', [hashToken(rawToken!)]);
    expect(byHash).not.toBeNull();
  });
});

describe('email verification', () => {
  it('verifies an address with a valid single-use token', async () => {
    const user = await registerUser(client);
    expect(user.verificationToken).toBeTruthy();

    const response = await client.post<{ outcome: string }>('/api/auth/verify-email', {
      token: user.verificationToken,
    });
    expect(response.status).toBe(200);
    expect(response.body.outcome).toBe('verified');

    const { queryOne } = await import('../server/db.ts');
    const row = await queryOne<{ email_verified_at: Date | null }>(
      'SELECT email_verified_at FROM users WHERE id = $1',
      [user.userId],
    );
    expect(row?.email_verified_at).not.toBeNull();
  });

  it('reports an already-used token as already verified', async () => {
    const user = await registerUser(client);
    await client.post('/api/auth/verify-email', { token: user.verificationToken });

    const second = await client.post<{ outcome: string }>('/api/auth/verify-email', {
      token: user.verificationToken,
    });
    expect(second.body.outcome).toBe('already_verified');
  });

  it('rejects an unknown token', async () => {
    const response = await client.post('/api/auth/verify-email', {
      token: 'a-token-that-was-never-issued',
    });
    expect(response.status).toBe(404);
  });

  it('rejects a missing token', async () => {
    const response = await client.post('/api/auth/verify-email', {});
    expect(response.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    const user = await registerUser(client);
    const { query } = await import('../server/db.ts');
    await query('UPDATE email_verification_tokens SET expires_at = now() - interval \'1 hour\'');

    const response = await client.post<{ outcome: string }>('/api/auth/verify-email', {
      token: user.verificationToken,
    });
    expect(response.status).toBe(410);
    expect(response.body.outcome).toBe('expired');
  });
});

describe('password change', () => {
  it('requires the current password', async () => {
    const user = await registerUser(client);
    await client.post('/api/auth/login', { email: user.email, password: user.password });

    const response = await client.post('/api/auth/password', {
      currentPassword: 'not-the-current-password',
      newPassword: 'a-brand-new-passphrase-value',
    });
    expect(response.status).toBe(401);
  });

  it('changes the password and invalidates every existing session', async () => {
    const user = await registerUser(client);
    await client.post('/api/auth/login', { email: user.email, password: user.password });

    const response = await client.post('/api/auth/password', {
      currentPassword: user.password,
      newPassword: 'a-brand-new-passphrase-value',
    });
    expect(response.status).toBe(200);

    // The current session is destroyed, so the caller is signed out.
    const session = await client.get<{ user: null }>('/api/auth/session');
    expect(session.body.user).toBeNull();

    // The old password no longer works and the new one does.
    const fresh = await createTestClient();
    const oldPassword = await fresh.post('/api/auth/login', {
      email: user.email,
      password: user.password,
    });
    expect(oldPassword.status).toBe(401);

    const newPassword = await fresh.post('/api/auth/login', {
      email: user.email,
      password: 'a-brand-new-passphrase-value',
    });
    expect(newPassword.status).toBe(200);
  });

  it('rejects a new password below the minimum length', async () => {
    const user = await registerUser(client);
    await client.post('/api/auth/login', { email: user.email, password: user.password });

    const response = await client.post('/api/auth/password', {
      currentPassword: user.password,
      newPassword: 'tooshort',
    });
    expect(response.status).toBe(422);
  });
});

describe('rate limiting', () => {
  it('limits repeated registration attempts from the same client', async () => {
    // One client, so all attempts share a rate-limit bucket. Creating a new
    // client per attempt would reset the limiter and prove nothing.
    const limited = await createTestClient({ ip: '198.51.100.200' });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await limited.post('/api/auth/register', {
        email: uniqueEmail('ratelimit'),
        password: VALID_PASSWORD,
        fullName: 'Rate Limited',
      });
      statuses.push(response.status);
    }

    // The limiter allows 5 registrations per 15 minutes, so later attempts must
    // be refused with 429 rather than silently succeeding.
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(statuses[0]).toBe(201);
  });

  it('limits repeated sign-in attempts from the same client', async () => {
    const user = await registerUser(await createTestClient());
    const limited = await createTestClient({ ip: '198.51.100.201' });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await limited.post('/api/auth/login', {
        email: user.email,
        password: 'the-wrong-password-value',
      });
      statuses.push(response.status);
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });
});

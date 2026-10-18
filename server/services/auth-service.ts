/**
 * Users, sessions and authentication.
 *
 * Authorisation is always derived from the database session row, never from a
 * client-supplied header, cookie payload or role field.
 */

import { query, queryOne, withTransaction } from '../db.ts';
import { hashPassword, verifyPassword } from '../crypto/password.ts';
import { generateToken, hashIp, hashToken } from '../crypto/tokens.ts';
import { getConfig } from '../config.ts';
import { conflict, unauthorized } from '../http/errors.ts';
import { getPool } from '../db.ts';

export type UserRole = 'member' | 'moderator' | 'admin';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  email_verified_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** The shape safe to return to a client: no hash, no lock counters. */
export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  emailVerified: boolean;
  createdAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    emailVerified: row.email_verified_at !== null,
    createdAt: row.created_at.toISOString(),
  };
}

/** How long an account is locked after repeated failed sign-ins. */
const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_MINUTES = 15;

/**
 * A real hash of a random value, generated once per process.
 *
 * Unknown-account sign-ins are checked against this so that a missing account
 * costs the same scrypt work as a wrong password. Without it, response time
 * would reveal which email addresses are registered.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(generateToken());
  return dummyHashPromise;
}

export interface SessionContext {
  user: UserRow;
  sessionId: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegisterResult {
  user: UserRow;
  verificationToken: string;
}

export async function registerUser(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<RegisterResult> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    input.email,
  ]);
  if (existing) {
    throw conflict('An account with that email address already exists.', {
      email: 'An account with that email address already exists.',
    });
  }

  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    const inserted = await client.query<UserRow>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.email, passwordHash, input.fullName],
    );
    const user = inserted.rows[0];
    if (!user) throw new Error('User insert returned no row.');

    // A single-use token is created eagerly. Nothing is verified by creating it:
    // the email_verified level is only recorded once the token is consumed.
    const token = generateToken();
    await client.query(
      `INSERT INTO email_verification_tokens (id, user_id, expires_at)
       VALUES ($1, $2, now() + interval '24 hours')`,
      [hashToken(token), user.id],
    );

    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1::uuid, 'user.registered', 'user', $2::text, $3::jsonb)`,
      [user.id, user.id, JSON.stringify({ email: user.email })],
    );

    return { user, verificationToken: token };
  });
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export type VerifyEmailOutcome = 'verified' | 'already_verified' | 'invalid' | 'expired';

export async function consumeEmailVerificationToken(token: string): Promise<VerifyEmailOutcome> {
  const tokenHash = hashToken(token);

  return withTransaction(async (client) => {
    const found = await client.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      `SELECT id, user_id, expires_at, consumed_at
         FROM email_verification_tokens
        WHERE id = $1
        FOR UPDATE`,
      [tokenHash],
    );
    const record = found.rows[0];
    if (!record) return 'invalid';
    if (record.consumed_at) return 'already_verified';
    if (record.expires_at.getTime() <= Date.now()) return 'expired';

    // COALESCE keeps the original verification timestamp if the account was
    // verified previously (for example a re-issued token).
    const updated = await client.query<{ email_verified_at: Date; was_already: boolean }>(
      `UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, now())
        WHERE id = $1
        RETURNING email_verified_at,
                  (email_verified_at IS DISTINCT FROM NULL
                   AND email_verified_at < now() - interval '1 second') AS was_already`,
      [record.user_id],
    );

    await client.query(`UPDATE email_verification_tokens SET consumed_at = now() WHERE id = $1`, [
      record.id,
    ]);

    if (updated.rows[0]?.was_already) return 'already_verified';

    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1::uuid, 'user.email_verified', 'user', $1::text, '{}'::jsonb)`,
      [record.user_id],
    );
    return 'verified';
  });
}

// ---------------------------------------------------------------------------
// Sign-in / sign-out
// ---------------------------------------------------------------------------

export type LoginOutcome =
  | { ok: true; user: UserRow; token: string; expiresAt: Date }
  | { ok: false; reason: 'invalid_credentials' | 'locked' | 'disabled' };

export async function loginUser(input: {
  email: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<LoginOutcome> {
  const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [input.email]);

  // Always run a verification, even for unknown accounts, so response time does
  // not reveal whether an email address is registered.
  if (!user) {
    await verifyPassword(input.password, await getDummyHash());
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (user.disabled_at) return { ok: false, reason: 'disabled' };

  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    return { ok: false, reason: 'locked' };
  }

  const passwordOk = await verifyPassword(input.password, user.password_hash);
  if (!passwordOk) {
    await query(
      `UPDATE users
          SET failed_login_count = failed_login_count + 1,
              locked_until = CASE
                WHEN failed_login_count + 1 >= $2 THEN now() + ($3 || ' minutes')::interval
                ELSE locked_until
              END
        WHERE id = $1`,
      [user.id, LOCKOUT_THRESHOLD, String(LOCKOUT_MINUTES)],
    );
    return { ok: false, reason: 'invalid_credentials' };
  }

  await query(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1',
    [user.id],
  );

  const token = generateToken();
  const config = getConfig();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), user.id, expiresAt, input.userAgent ?? null, hashIp(input.ip)],
  );

  await query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata, ip_hash)
     VALUES ($1::uuid, 'user.signed_in', 'user', $1::text, '{}'::jsonb, $2)`,
    [user.id, hashIp(input.ip)],
  );

  return { ok: true, user, token, expiresAt };
}

/**
 * Resolves a session token to a user.
 * Expired sessions are rejected. `disabled_at` invalidates access immediately.
 */
export async function resolveSession(token: string | undefined): Promise<SessionContext | null> {
  if (!token) return null;
  const sessionId = hashToken(token);

  const row = await queryOne<UserRow & { session_id: string; session_expires_at: Date }>(
    `SELECT u.*, s.id AS session_id, s.expires_at AS session_expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  );
  if (!row) return null;
  if (row.disabled_at) return null;

  return { user: row, sessionId: row.session_id, expiresAt: row.session_expires_at };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await query('DELETE FROM sessions WHERE id = $1', [hashToken(token)]);
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const user = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [input.userId]);
  if (!user) throw unauthorized();

  const ok = await verifyPassword(input.currentPassword, user.password_hash);
  if (!ok) throw unauthorized('Your current password is not correct.');

  const newHash = await hashPassword(input.newPassword);
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [input.userId, newHash]);
  // Any other device holding a session for this account is signed out.
  await destroyAllSessionsForUser(input.userId);
  await query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1::uuid, 'user.password_changed', 'user', $1::text, '{}'::jsonb)`,
    [input.userId],
  );
}

/** Housekeeping: removes expired sessions and stale verification tokens. */
export async function purgeExpiredCredentials(): Promise<{ sessions: number; tokens: number }> {
  const sessions = await query<{ id: string }>('DELETE FROM sessions WHERE expires_at <= now() RETURNING id');
  const tokens = await query<{ id: string }>(
    `DELETE FROM email_verification_tokens
      WHERE expires_at <= now() OR consumed_at IS NOT NULL
      RETURNING id`,
  );
  return { sessions: sessions.length, tokens: tokens.length };
}

/** Used by tests and by the seed script. */
export async function countUsers(): Promise<number> {
  const row = await queryOne<{ count: string }>('SELECT count(*)::text AS count FROM users');
  return Number(row?.count ?? '0');
}

export function poolForTests() {
  return getPool();
}

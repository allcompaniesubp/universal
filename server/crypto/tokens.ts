/**
 * Opaque token generation and hashing.
 *
 * Session tokens and email-verification tokens are high-entropy random strings.
 * Only their SHA-256 digest is persisted, so read access to the database does
 * not hand an attacker a usable cookie or verification link.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes -> 256 bits of entropy, base64url encoded. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests of equal length. */
export function digestsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Hashes a client IP for storage in the audit log and session rows.
 * IPs are personal data, so the raw value is never persisted.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip, 'utf8').digest('hex').slice(0, 32);
}

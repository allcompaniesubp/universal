/**
 * Password hashing.
 *
 * scrypt is used from Node's standard library: no native module to compile and
 * no paid dependency. Parameters are stored alongside each hash so that the
 * cost can be raised later without invalidating existing passwords.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
// scrypt needs roughly 128 * N * r bytes; give it generous headroom.
const MAX_MEM = 256 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 12;

/** Normalises so that visually identical passwords hash identically. */
function normalise(password: string): string {
  return password.normalize('NFKC');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(normalise(password), salt, KEY_LENGTH, {
    ...DEFAULT_PARAMS,
    maxmem: MAX_MEM,
  });
  return [
    'scrypt',
    DEFAULT_PARAMS.N,
    DEFAULT_PARAMS.r,
    DEFAULT_PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Verifies a password against a stored hash in constant time.
 * Returns false rather than throwing for malformed stored values.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [scheme, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [
    string, string, string, string, string, string,
  ];
  if (scheme !== 'scrypt') return false;

  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N < 2 || r < 1 || p < 1) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltRaw, 'base64');
    expected = Buffer.from(hashRaw, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scryptAsync(normalise(password), salt, expected.length, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

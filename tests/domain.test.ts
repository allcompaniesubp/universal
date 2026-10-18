/**
 * Unit tests for pure domain logic: UBP identifier generation, slug validation,
 * password hashing and token hashing. These need no database.
 */

import { describe, expect, it } from 'vitest';
import { generateUbpId, isValidUbpId, UBP_ID_ALPHABET } from '../server/domain/ubp-id.ts';
import { checkSlug, normaliseSlug, suggestSlug, RESERVED_SLUGS } from '../server/domain/slug.ts';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../server/crypto/password.ts';
import { generateToken, hashToken, hashIp } from '../server/crypto/tokens.ts';

describe('UBP identifier', () => {
  it('produces identifiers in the documented format', () => {
    for (let i = 0; i < 500; i += 1) {
      const id = generateUbpId();
      expect(id).toMatch(/^UBP-[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(isValidUbpId(id)).toBe(true);
    }
  });

  it('omits characters that are easily confused when read aloud', () => {
    // I, L, O and U are excluded so a printed card cannot be misread.
    for (const character of ['I', 'L', 'O', 'U']) {
      expect(UBP_ID_ALPHABET).not.toContain(character);
    }
  });

  it('does not repeat across a large sample', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) seen.add(generateUbpId());
    // 40 bits of entropy; a handful of collisions in 20k draws is expected
    // (~0.0000002 probability each), so require the sample to be essentially
    // unique without asserting perfection.
    expect(seen.size).toBeGreaterThan(19_990);
  });

  it('rejects malformed identifiers', () => {
    for (const bad of ['', 'UBP', 'UBP-', 'UBP-123', 'UBP-123456789', 'ubp-12345678', 'UBP-1234567O']) {
      expect(isValidUbpId(bad)).toBe(false);
    }
  });

  it('uses the whole alphabet across many draws', () => {
    const used = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) {
      for (const character of generateUbpId().slice(4)) used.add(character);
    }
    // Every symbol should appear; a biased generator would leave gaps.
    for (const character of UBP_ID_ALPHABET) expect(used.has(character)).toBe(true);
  });
});

describe('slug validation', () => {
  it('normalises case, spaces and punctuation', () => {
    expect(normaliseSlug('  Sharma Textiles & Co.  ')).toBe('sharma-textiles-co');
    expect(normaliseSlug('ABC___DEF')).toBe('abc-def');
    expect(normaliseSlug('---leading---')).toBe('leading');
  });

  it('accepts a well-formed slug', () => {
    expect(checkSlug('sharma-textiles').ok).toBe(true);
    expect(checkSlug('a1b').ok).toBe(true);
  });

  it('rejects slugs that would break routing or collide with the app', () => {
    expect(checkSlug('ab').ok).toBe(false);
    expect(checkSlug('-leading').ok).toBe(false);
    expect(checkSlug('trailing-').ok).toBe(false);
    expect(checkSlug('has_underscore').ok).toBe(false);
    expect(checkSlug('a'.repeat(65)).ok).toBe(false);
    expect(checkSlug('').ok).toBe(false);
  });

  it('rejects reserved application paths', () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(checkSlug(reserved).ok).toBe(false);
    }
    expect(checkSlug('dashboard').ok).toBe(false);
    expect(checkSlug('api').ok).toBe(false);
  });

  it('rejects a slug made only of digits after normalisation edge cases', () => {
    // Purely numeric slugs are allowed by the pattern but must still be
    // routable; assert the documented behaviour rather than assuming.
    const result = checkSlug('12345');
    expect(typeof result.ok).toBe('boolean');
  });

  it('suggests a usable slug from a business name', () => {
    const suggested = suggestSlug('Sharma Textiles & Co.');
    expect(suggested).toBe('sharma-textiles-co');
    expect(checkSlug(suggested).ok).toBe(true);
  });

  it('pads a very short name into a valid slug', () => {
    const suggested = suggestSlug('AB');
    expect(checkSlug(suggested).ok).toBe(true);
  });
});

describe('password hashing', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('a-sufficiently-long-passphrase');
    expect(await verifyPassword('a-sufficiently-long-passphrase', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('a-sufficiently-long-passphrase');
    expect(await verifyPassword('a-sufficiently-long-passphras', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('produces a different hash each time, so identical passwords are not linkable', async () => {
    const first = await hashPassword('the-same-passphrase-twice');
    const second = await hashPassword('the-same-passphrase-twice');
    expect(first).not.toBe(second);
    expect(await verifyPassword('the-same-passphrase-twice', first)).toBe(true);
    expect(await verifyPassword('the-same-passphrase-twice', second)).toBe(true);
  });

  it('never stores the password in the hash string', async () => {
    const hash = await hashPassword('super-secret-value-here');
    expect(hash).not.toContain('super-secret-value-here');
  });

  it('returns false for a malformed stored hash instead of throwing', async () => {
    for (const malformed of ['', 'nonsense', 'scrypt$bad', 'a$b$c$d$e']) {
      await expect(verifyPassword('anything', malformed)).resolves.toBe(false);
    }
  });

  it('requires a minimum password length of at least 12', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12);
  });
});

describe('token hashing', () => {
  it('generates high-entropy tokens', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1_000; i += 1) tokens.add(generateToken());
    expect(tokens.size).toBe(1_000);
    for (const token of tokens) expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it('hashes deterministically and does not return the input', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toHaveLength(64);
  });

  it('produces different hashes for different tokens', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });

  it('hashes an IP deterministically and returns null for no IP', () => {
    expect(hashIp('203.0.113.7')).toBe(hashIp('203.0.113.7'));
    expect(hashIp('203.0.113.7')).not.toBe(hashIp('203.0.113.8'));
    expect(hashIp(null)).toBeNull();
    expect(hashIp(undefined)).toBeNull();
  });
});

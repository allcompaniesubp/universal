/**
 * Universal Business Passport identifier generation.
 *
 * Format: UBP-XXXXXXXX where X is drawn from a 32-character alphabet that
 * omits I, L, O and U. Those letters are the ones most often confused with
 * 1/0 when a business reads its ID aloud or copies it from a printed card.
 *
 * 8 characters over a 32-symbol alphabet is 40 bits, and because 256 divides
 * evenly by 32 there is no modulo bias. Collisions are still handled by a
 * unique index and a bounded retry, never by trusting the generator alone.
 */

import { randomBytes } from 'node:crypto';

export const UBP_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const UBP_ID_LENGTH = 8;
export const UBP_ID_PATTERN = /^UBP-[0-9A-HJKMNP-TV-Z]{8}$/;

export type RandomBytes = (size: number) => Buffer;

export function generateUbpId(random: RandomBytes = randomBytes): string {
  const bytes = random(UBP_ID_LENGTH);
  let suffix = '';
  for (let i = 0; i < UBP_ID_LENGTH; i += 1) {
    const byte = bytes[i] ?? 0;
    suffix += UBP_ID_ALPHABET[byte % UBP_ID_ALPHABET.length];
  }
  return `UBP-${suffix}`;
}

export function isValidUbpId(value: string): boolean {
  return UBP_ID_PATTERN.test(value);
}

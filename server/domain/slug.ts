/**
 * Business slug rules.
 *
 * A slug is the public path segment for a free business micro-page
 * (/business/<slug>), so it must be URL-safe, stable and not confusable with
 * platform routes. Reserved words are rejected to stop a business from taking a
 * path the application itself needs.
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/**
 * Reserved because they collide with application routes or with paths the
 * platform reserves for itself. Compared against the candidate slug, and also
 * against its first hyphen-delimited segment (so "admin-x" is rejected too).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api', 'admin', 'administrator', 'dashboard', 'login', 'logout', 'register',
  'signup', 'signin', 'sign-in', 'sign-up', 'verify', 'verification', 'business',
  'businesses', 'directory', 'discover', 'search', 'pricing', 'about', 'help',
  'support', 'legal', 'privacy', 'terms', 'settings', 'account', 'profile',
  'products', 'services', 'jobs', 'resources', 'grants', 'networking', 'learn',
  'events', 'ai', 'hub', 'passport', 'ubp', 'static', 'assets', 'public',
  'well-known', 'robots', 'sitemap', 'favicon', 'index', 'new', 'edit', 'null',
  'undefined', 'www', 'mail', 'email', 'root', 'system', 'test', 'demo',
]);

export interface SlugCheck {
  ok: boolean;
  reason?: string;
}

export function normaliseSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function checkSlug(slug: string): SlugCheck {
  if (slug.length < 3) return { ok: false, reason: 'Slug must be at least 3 characters.' };
  if (slug.length > 64) return { ok: false, reason: 'Slug must be at most 64 characters.' };
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      reason: 'Slug may contain only lowercase letters, digits and single hyphens, and must start and end with a letter or digit.',
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: `"${slug}" is reserved by the platform.` };
  }
  const firstSegment = slug.split('-')[0] ?? '';
  if (RESERVED_SLUGS.has(firstSegment)) {
    return { ok: false, reason: `Slug may not begin with the reserved word "${firstSegment}".` };
  }
  return { ok: true };
}

/**
 * Derives a candidate slug from a business name.
 *
 * The result is normalised and padded to the minimum length, because a two-letter
 * business name would otherwise produce a slug that `checkSlug` rejects. The
 * result is still not guaranteed to be free of collisions or reserved words;
 * callers must check it.
 */
export function suggestSlug(displayName: string): string {
  const base = normaliseSlug(displayName).slice(0, 64).replace(/-+$/g, '');
  if (base.length >= 3) return base;
  if (base.length === 0) return 'my-business';
  // Pad rather than truncate, so "AB" becomes "ab-business" instead of failing.
  return `${base}-business`.slice(0, 64);
}

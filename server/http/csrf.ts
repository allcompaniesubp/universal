/**
 * Cross-site request forgery protection for state-changing requests.
 *
 * Two independent checks must both pass on every state-changing API request:
 *
 *   1. A double-submit token. A random value is stored in a readable cookie and
 *      must be echoed in the `X-CSRF-Token` header. A cross-site page can cause
 *      the browser to send the cookie, but cannot read it, so it cannot produce
 *      the matching header.
 *   2. An `Origin`/`Referer` check against the configured public origin.
 *
 * Why the cookie is deliberately *not* `SameSite=Strict`: the session cookie is
 * `Lax`, so a top-level cross-site GET still carries it. Relying on SameSite
 * alone would leave same-site requests unprotected, and this deployment is
 * intended to live at `allcompanies.unspuniversity.com`, where *any other
 * subdomain of `unspuniversity.com` is same-site*. A hostile or compromised
 * sibling subdomain would therefore pass the SameSite check. The origin
 * comparison below is exact — only the configured origin is accepted — so a
 * sibling subdomain is rejected exactly like any other cross-site caller.
 *
 * The `Origin` header is safe to use here even though the general rule is that
 * request headers are untrusted: a browser sets it, and a cross-site attacker
 * cannot forge it for the victim's browser.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config.ts';
import { forbidden } from './errors.ts';
import type { ApiRequest } from './router.ts';

/** Readable by script on purpose: the client must echo it in a header. */
export const CSRF_COOKIE_NAME = 'ubp_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Methods that must not change state, and so are not CSRF-checked. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function headerValue(request: ApiRequest, name: string): string | null {
  const raw = request.headers[name];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return null;
}

/**
 * Compares the request's origin against the configured public origin.
 *
 * `Origin` is preferred; `Referer` is used as a fallback because some older
 * clients omit `Origin` on same-origin POSTs. When neither is present the
 * request is rejected, since a legitimate browser sends at least one for a
 * state-changing cross-document request.
 */
function originAllowed(request: ApiRequest, config: AppConfig): boolean {
  const expected = config.publicBaseUrl.replace(/\/+$/, '');
  const origin = headerValue(request, 'origin');

  if (origin && origin !== 'null') {
    return origin.replace(/\/+$/, '') === expected;
  }

  const referer = headerValue(request, 'referer');
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Rejects a state-changing request that fails either CSRF check.
 *
 * Applied centrally in `dispatch`, so a newly added mutating route is protected
 * by default rather than relying on each handler to remember.
 */
export function requireCsrf(request: ApiRequest, config: AppConfig): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const cookieToken = request.cookies[CSRF_COOKIE_NAME];
  const headerToken = headerValue(request, CSRF_HEADER_NAME);

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw forbidden(
      'This request could not be verified as coming from this site. Reload the page and try again.',
    );
  }

  if (!originAllowed(request, config)) {
    throw forbidden(
      'This request could not be verified as coming from this site. Reload the page and try again.',
    );
  }
}

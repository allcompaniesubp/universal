/**
 * Minimal cookie parsing and serialisation.
 *
 * Written by hand rather than pulled from a dependency so that the security
 * attributes (HttpOnly, SameSite, Secure, Path) are explicit and auditable.
 */

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  path?: string;
  maxAgeSeconds?: number;
  expires?: Date;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(rawValue);
    } catch {
      out[name] = rawValue;
    }
  }
  return out;
}

export function serialiseCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path ?? '/'}`);
  if (options.maxAgeSeconds !== undefined) segments.push(`Max-Age=${Math.floor(options.maxAgeSeconds)}`);
  if (options.expires) segments.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly ?? true) segments.push('HttpOnly');
  if (options.secure) segments.push('Secure');
  segments.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return segments.join('; ');
}

export function clearCookie(name: string, options: CookieOptions = {}): string {
  return serialiseCookie(name, '', { ...options, maxAgeSeconds: 0 });
}

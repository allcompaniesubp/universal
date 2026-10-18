/**
 * Runtime configuration, read once from the environment.
 *
 * Secrets live only in server-side environment variables. Nothing in this file
 * is ever bundled into the client: the client only ever sees the small set of
 * values returned by the public API routes.
 *
 * `PUBLIC_BASE_URL` is the only trusted source of an absolute origin. A `Host`
 * or `X-Forwarded-Host` header is attacker-controlled and is never consulted, so
 * QR codes, share links, email links and CSRF checks cannot be steered to a
 * domain the operator did not configure.
 */

export interface AppConfig {
  databaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  /** True when running on a deployed platform (production or a preview). */
  isDeployed: boolean;
  /** Canonical origin for QR codes, share links, email links and CSRF checks. */
  publicBaseUrl: string;
  /** True when `PUBLIC_BASE_URL` came from the environment rather than the dev default. */
  publicBaseUrlExplicit: boolean;
  sessionCookieName: string;
  sessionTtlDays: number;
  emailTransport: 'none' | 'console';
  emailFrom: string | null;
  /**
   * The request header that a trusted edge sets with the real client IP, or null
   * when the deployment has no such edge and the socket address must be used.
   *
   * The value is never taken from an arbitrary client header: `X-Forwarded-For`
   * is appended to, not replaced, by most proxies, so its first entry is
   * attacker-controlled and would let a caller rotate a fake IP to evade the
   * rate limiter. Only a platform known to overwrite the header qualifies.
   */
  trustedIpHeader: 'x-vercel-forwarded-for' | 'x-forwarded-for' | null;
}

export class ConfigError extends Error {}

/** Used only when no PUBLIC_BASE_URL is configured in local development. */
export const DEVELOPMENT_ORIGIN = 'http://localhost:5173';

function readNodeEnv(): AppConfig['nodeEnv'] {
  const raw = process.env.NODE_ENV;
  if (raw === 'production' || raw === 'test') return raw;
  return 'development';
}

/**
 * Validates `PUBLIC_BASE_URL` and reduces it to a bare origin.
 *
 * Rejected on purpose:
 *   - a missing value on a deployed environment, because the request origin is
 *     not trustworthy and an unconfigured deployment would otherwise emit
 *     attacker-controlled links;
 *   - a non-https value on a deployed environment;
 *   - any path, query or fragment, which would silently corrupt generated links.
 */
function readPublicBaseUrl(raw: string, isDeployed: boolean): string {
  if (raw.length === 0) {
    if (isDeployed) {
      throw new ConfigError(
        'PUBLIC_BASE_URL must be set on a deployed environment (production or preview). ' +
          'It is the only trusted source of absolute URLs, so it cannot be inferred from ' +
          'the request. Example: https://ubp-preview.example.vercel.app',
      );
    }
    return DEVELOPMENT_ORIGIN;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(
      'PUBLIC_BASE_URL is not a valid absolute URL. Received a value that does not parse. ' +
        'Example: https://ubp-preview.example.vercel.app',
    );
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError('PUBLIC_BASE_URL must use http or https.');
  }
  if (isDeployed && url.protocol !== 'https:') {
    throw new ConfigError(
      'PUBLIC_BASE_URL must use https on a deployed environment. ' +
        'Plain http would let a network attacker rewrite verification and QR links.',
    );
  }
  if (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0) {
    throw new ConfigError(
      'PUBLIC_BASE_URL must be an origin only, with no path, query or fragment. ' +
        'Use https://example.com rather than https://example.com/app.',
    );
  }

  return url.origin;
}

/**
 * Decides which header, if any, may be trusted as the client IP.
 *
 * Vercel documents that it overwrites `X-Forwarded-For` and does not forward an
 * external value, so `x-vercel-forwarded-for` is the safe choice there; it is
 * preferred over `x-forwarded-for` because a proxy placed in front of Vercel
 * could otherwise overwrite the latter.
 *
 * Anywhere else (the local dev server, a self-hosted run) there is no such
 * guarantee, so no header is trusted and the socket address is used. The local
 * server therefore sees every request from the socket address; that is a known
 * limitation of running without an edge, not a bypass.
 */
function readTrustedIpHeader(env: NodeJS.ProcessEnv): AppConfig['trustedIpHeader'] {
  const override = env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (override === 'none') return null;
  if (override === 'x-vercel-forwarded-for' || override === 'x-forwarded-for') return override;

  return env.VERCEL ? 'x-vercel-forwarded-for' : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ConfigError(
      'DATABASE_URL is not set. Configure it in the environment (see .env.example).',
    );
  }

  const nodeEnv = readNodeEnv();
  const rawPublicBaseUrl = env.PUBLIC_BASE_URL?.trim() ?? '';
  // A preview deployment sets PUBLIC_BASE_URL without NODE_ENV=production, and it
  // is just as exposed to hostile Host headers as production, so either signal
  // marks the deployment as trusted-origin-only.
  const isDeployed = nodeEnv === 'production' || rawPublicBaseUrl.length > 0;

  return {
    databaseUrl,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isDeployed,
    publicBaseUrl: readPublicBaseUrl(rawPublicBaseUrl, isDeployed),
    publicBaseUrlExplicit: rawPublicBaseUrl.length > 0,
    sessionCookieName: env.SESSION_COOKIE_NAME?.trim() || 'ubp_session',
    sessionTtlDays: 14,
    emailTransport: env.EMAIL_TRANSPORT?.trim() === 'console' ? 'console' : 'none',
    emailFrom: env.EMAIL_FROM?.trim() || null,
    trustedIpHeader: readTrustedIpHeader(env),
  };
}

/** A conservative IPv4/IPv6 literal check, so a header value cannot inject a bucket key. */
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,45}$/;

function looksLikeIp(value: string): boolean {
  if (IPV4.test(value)) {
    return value.split('.').every((part) => Number(part) <= 255);
  }
  return IPV6.test(value) && value.includes(':');
}

/**
 * Extracts the client IP for rate limiting and audit hashing.
 *
 * Only the header named by `config.trustedIpHeader` is consulted, and only when
 * it carries a single syntactically valid address. A value that does not parse,
 * or that carries a comma-separated chain, is discarded in favour of the socket
 * address rather than trusted. This is what closes the rotating-header bypass:
 * on a deployment with no trusted edge there is nothing to spoof.
 */
export function resolveClientIp(
  config: AppConfig,
  headers: Record<string, string | string[] | undefined>,
  socketAddress: string | null,
): string | null {
  if (!config.trustedIpHeader) return socketAddress;

  const raw = headers[config.trustedIpHeader];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';

  // A chain means a proxy appended to a client-supplied value; take the last hop
  // only when it is itself a single valid address. Anything else falls back to
  // the socket, which the platform sets.
  const candidate = value.includes(',') ? (value.split(',').pop()?.trim() ?? '') : value;
  if (candidate && looksLikeIp(candidate)) return candidate;

  return socketAddress;
}

/**
 * Whether session and CSRF cookies may be marked `Secure`.
 *
 * Derived from the configured origin rather than from NODE_ENV, so a preview
 * deployment served over https also gets hardened cookies.
 */
export function usesSecureCookies(config: AppConfig): boolean {
  return config.isProduction || config.publicBaseUrl.startsWith('https://');
}

let cached: AppConfig | null = null;

/** Lazily-loaded process-wide config. Tests may call `resetConfig()`. */
export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

export function resetConfig(): void {
  cached = null;
}

export function setConfigForTesting(config: AppConfig): void {
  cached = config;
}

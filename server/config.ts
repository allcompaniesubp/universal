/**
 * Runtime configuration, read once from the environment.
 *
 * Secrets live only in server-side environment variables. Nothing in this file
 * is ever bundled into the client: the client only ever sees the small set of
 * values returned by the public API routes.
 */

export interface AppConfig {
  databaseUrl: string;
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  /** Absolute origin used for QR codes and share links. */
  publicBaseUrl: string | null;
  sessionCookieName: string;
  sessionTtlDays: number;
  emailTransport: 'none' | 'console';
  emailFrom: string | null;
}

export class ConfigError extends Error {}

function readNodeEnv(): AppConfig['nodeEnv'] {
  const raw = process.env.NODE_ENV;
  if (raw === 'production' || raw === 'test') return raw;
  return 'development';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ConfigError(
      'DATABASE_URL is not set. Configure it in the environment (see .env.example).',
    );
  }

  const nodeEnv = readNodeEnv();
  const publicBaseUrl = env.PUBLIC_BASE_URL?.trim() || null;

  return {
    databaseUrl,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    publicBaseUrl: publicBaseUrl ? publicBaseUrl.replace(/\/+$/, '') : null,
    sessionCookieName: env.SESSION_COOKIE_NAME?.trim() || 'ubp_session',
    sessionTtlDays: 14,
    emailTransport: env.EMAIL_TRANSPORT?.trim() === 'console' ? 'console' : 'none',
    emailFrom: env.EMAIL_FROM?.trim() || null,
  };
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

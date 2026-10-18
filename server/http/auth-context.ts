/**
 * Authentication context helpers shared by route handlers.
 *
 * The signed-in user is resolved from the session cookie on every request. Role
 * checks read `users.role` from the database row, never from the request.
 */

import type { z } from 'zod';
import { resolveSession, type UserRow } from '../services/auth-service.ts';
import { forbidden, tooManyRequests, unauthorized, validationFailed } from './errors.ts';
import type { ApiRequest } from './router.ts';
import { checkRateLimit } from './rate-limit.ts';
import { hashIp } from '../crypto/tokens.ts';

export async function requireUser(request: ApiRequest, cookieName: string): Promise<UserRow> {
  const session = await resolveSession(request.cookies[cookieName]);
  if (!session) throw unauthorized();
  return session.user;
}

export async function optionalUser(
  request: ApiRequest,
  cookieName: string,
): Promise<UserRow | null> {
  const session = await resolveSession(request.cookies[cookieName]);
  return session?.user ?? null;
}

export function requireRole(user: UserRow, roles: readonly ('moderator' | 'admin')[]): void {
  if (!roles.includes(user.role as 'moderator' | 'admin')) {
    throw forbidden('You do not have permission to view this.');
  }
}

/**
 * Validates a request body against a schema and returns the parsed value.
 * Produces a field-keyed error map so the client can highlight inputs.
 */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? issue.path.join('.') : '_form';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw validationFailed(fields);
  }
  return result.data;
}

/**
 * Applies a rate limit keyed by route and client IP.
 * Falls back to a shared bucket when no IP is available, so the limit is never
 * silently skipped.
 */
export function enforceRateLimit(
  request: ApiRequest,
  bucketName: keyof typeof import('./rate-limit.ts').RATE_LIMITS,
  limits: { limit: number; windowSeconds: number },
): void {
  const identity = hashIp(request.ip) ?? 'unknown-client';
  const result = checkRateLimit(`${bucketName}:${identity}`, limits.limit, limits.windowSeconds);
  if (!result.allowed) {
    throw tooManyRequests(
      `Too many attempts. Please try again in ${result.retryAfterSeconds} seconds.`,
    );
  }
}

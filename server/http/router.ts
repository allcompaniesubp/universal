/**
 * Framework-agnostic request/response types and a tiny path router.
 *
 * The same handlers are served by the Express-based dev server and by the Vercel
 * serverless function, so route behaviour cannot drift between local
 * development and deployment.
 */

import type { IncomingHttpHeaders } from 'node:http';
import { parseCookies } from './cookies.ts';

export interface ApiRequest {
  method: string;
  /** Path with no query string, e.g. "/api/businesses/abc". */
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  cookies: Record<string, string>;
  /** Parsed JSON body, or undefined when the request had no body. */
  body: unknown;
  /** Best-effort client IP; only ever stored as a hash. */
  ip: string | null;
  /** Absolute origin of the incoming request, used for same-origin checks. */
  origin: string | null;
}

export interface ResponseCookie {
  name: string;
  value: string;
  options: import('./cookies.ts').CookieOptions;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  cookies?: ResponseCookie[];
}

export type RouteHandler = (request: ApiRequest) => Promise<ApiResponse>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split('/').filter((segment) => segment.length > 0),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): this {
    return this.add('POST', pattern, handler);
  }

  patch(pattern: string, handler: RouteHandler): this {
    return this.add('PATCH', pattern, handler);
  }

  delete(pattern: string, handler: RouteHandler): this {
    return this.add('DELETE', pattern, handler);
  }

  /**
   * Finds a handler. Returns `methodMismatch` when the path matches a route
   * registered under a different method, so the caller can answer 405 rather
   * than a misleading 404.
   *
   * Static segments win over parameter segments: `/api/businesses/slug-suggestion`
   * must not be captured by `/api/businesses/:id` merely because the latter was
   * registered first. Routes are therefore tried in two passes, all-static
   * routes before any route containing a parameter.
   */
  match(
    method: string,
    path: string,
  ): { handler: RouteHandler; params: Record<string, string> } | { methodMismatch: true } | null {
    const requestSegments = path.split('/').filter((segment) => segment.length > 0);
    let pathMatchedOtherMethod = false;

    const candidates = this.routes.filter(
      (route) => route.segments.length === requestSegments.length,
    );
    const ordered = [
      ...candidates.filter((route) => !route.segments.some((segment) => segment.startsWith(':'))),
      ...candidates.filter((route) => route.segments.some((segment) => segment.startsWith(':'))),
    ];

    for (const route of ordered) {
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const patternSegment = route.segments[i] ?? '';
        const requestSegment = requestSegments[i] ?? '';
        if (patternSegment.startsWith(':')) {
          const name = patternSegment.slice(1);
          let decoded = requestSegment;
          try {
            decoded = decodeURIComponent(requestSegment);
          } catch {
            // Leave the raw segment; validation will reject it if malformed.
          }
          params[name] = decoded;
        } else if (patternSegment !== requestSegment) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;

      if (route.method === method.toUpperCase()) return { handler: route.handler, params };
      pathMatchedOtherMethod = true;
    }

    return pathMatchedOtherMethod ? { methodMismatch: true } : null;
  }
}

export function createRequest(input: {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: unknown;
  ip?: string | null;
}): ApiRequest {
  const parsed = new URL(input.url, 'http://localhost');
  const host = input.headers.host ?? 'localhost';
  const forwardedProto = input.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0]?.trim() : 'http';

  return {
    method: input.method.toUpperCase(),
    path: parsed.pathname,
    params: {},
    query: parsed.searchParams,
    headers: input.headers,
    cookies: parseCookies(input.headers.cookie),
    body: input.body,
    ip: input.ip ?? null,
    origin: `${proto || 'http'}://${host}`,
  };
}

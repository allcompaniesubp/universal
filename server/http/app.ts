/**
 * Application assembly.
 *
 * One place builds the route table, and both entry points use it:
 *   - server/dev-server.ts  (Express, local development and `npm start`)
 *   - api/index.ts          (Vercel serverless function)
 *
 * Because the routing, validation and error handling live here rather than in
 * the adapters, local behaviour and deployed behaviour cannot diverge.
 */

import { AppError } from './errors.ts';
import { Router, type ApiRequest, type ApiResponse } from './router.ts';
import { registerAuthRoutes } from '../routes/auth-routes.ts';
import { registerBusinessRoutes } from '../routes/business-routes.ts';
import { registerAdminRoutes } from '../routes/admin-routes.ts';
import { getConfig } from '../config.ts';
import { requireCsrf } from './csrf.ts';

export function buildRouter(): Router {
  const router = new Router();
  registerAuthRoutes(router);
  registerBusinessRoutes(router);
  registerAdminRoutes(router);
  return router;
}

/** Adds baseline security headers to every API response. */
function withSecurityHeaders(response: ApiResponse): ApiResponse {
  return {
    ...response,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store',
      ...response.headers,
    },
  };
}

function errorResponse(error: unknown, isProduction: boolean): ApiResponse {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }

  // Unexpected failure: log server-side, return a generic message so SQL text,
  // stack traces and internal identifiers are not exposed to the caller.
  // eslint-disable-next-line no-console
  console.error('[ubp] Unhandled API error:', error instanceof Error ? error.message : error);

  return {
    status: 500,
    body: {
      error: {
        code: 'internal_error',
        message: isProduction
          ? 'Something went wrong. Please try again.'
          : `Internal error: ${error instanceof Error ? error.message : String(error)}`,
      },
    },
  };
}

export interface DispatchOptions {
  isProduction: boolean;
}

export async function dispatch(
  router: Router,
  request: ApiRequest,
  options: DispatchOptions,
): Promise<ApiResponse> {
  let response: ApiResponse;
  try {
    const matched = router.match(request.method, request.path);

    if (!matched) {
      response = {
        status: 404,
        body: { error: { code: 'not_found', message: 'No API route matches this request.' } },
      };
    } else if ('methodMismatch' in matched) {
      response = {
        status: 405,
        body: { error: { code: 'method_not_allowed', message: 'That method is not allowed here.' } },
      };
    } else {
      // CSRF is enforced centrally, after routing so that an unknown path still
      // answers 404, but before the handler runs. A route added later is
      // therefore protected without opting in, and there is no bypass flag.
      requireCsrf(request, getConfig());
      request.params = matched.params;
      response = await matched.handler(request);
    }
  } catch (error) {
    response = errorResponse(error, options.isProduction);
  }

  return withSecurityHeaders(response);
}

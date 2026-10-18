/**
 * Vercel serverless entry point.
 *
 * Vercel rewrites everything that is not /api/* to index.html, so this function
 * only ever receives API traffic. The Node request/response objects are adapted
 * to the same internal request shape the dev server uses, and the shared router
 * in server/http/app.ts does the work.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildRouter, dispatch } from '../server/http/app.ts';
import { createRequest } from '../server/http/router.ts';
import { serialiseCookie } from '../server/http/cookies.ts';
import { loadConfig, ConfigError } from '../server/config.ts';
import type { ApiResponse } from '../server/http/router.ts';

const router = buildRouter();

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  // Bodies are small JSON payloads; anything larger is rejected rather than
  // buffered without limit.
  const MAX_BYTES = 256 * 1024;

  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_BYTES) throw new Error('Request body too large.');
    chunks.push(buffer);
  }

  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) return undefined;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function writeResponse(response: ServerResponse, result: ApiResponse): void {
  response.statusCode = result.status;

  for (const [key, value] of Object.entries(result.headers ?? {})) {
    if (key.toLowerCase() === 'set-cookie') continue;
    response.setHeader(key, value);
  }
  if (result.cookies && result.cookies.length > 0) {
    response.setHeader(
      'Set-Cookie',
      result.cookies.map((cookie) => serialiseCookie(cookie.name, cookie.value, cookie.options)),
    );
  }

  if (result.body === undefined) {
    response.end();
    return;
  }

  const contentType = result.headers?.['Content-Type'] ?? '';
  if (typeof result.body === 'string' && !contentType.includes('application/json')) {
    response.end(result.body);
    return;
  }

  if (!response.getHeader('Content-Type')) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  response.end(JSON.stringify(result.body));
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const config = loadConfig();
    const url = request.url ?? '/';
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request);

    const forwarded = request.headers['x-forwarded-for'];
    const ip =
      typeof forwarded === 'string' && forwarded.length > 0
        ? (forwarded.split(',')[0]?.trim() ?? null)
        : (request.socket.remoteAddress ?? null);

    const apiRequest = createRequest({
      method: request.method ?? 'GET',
      url,
      headers: request.headers,
      body,
      ip,
    });

    const result = await dispatch(router, apiRequest, { isProduction: config.isProduction });
    writeResponse(response, result);
  } catch (error) {
    const isConfigError = error instanceof ConfigError;
    response.statusCode = isConfigError ? 503 : 500;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({
        error: {
          code: isConfigError ? 'not_configured' : 'internal_error',
          message: isConfigError
            ? 'The server is not fully configured. Set the required environment variables.'
            : 'Something went wrong.',
        },
      }),
    );
  }
}

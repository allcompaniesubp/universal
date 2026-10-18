/**
 * Error types for the API layer.
 *
 * Only `AppError` messages are ever returned to a client. Anything else is
 * logged server-side and reported as a generic 500, so internal details,
 * SQL text and stack traces never reach the browser.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, details);

export const validationFailed = (details: unknown) =>
  new AppError(422, 'validation_failed', 'Some of the information provided is not valid.', details);

export const unauthorized = (message = 'You must be signed in to do that.') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have permission to do that.') =>
  new AppError(403, 'forbidden', message);

export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'conflict', message, details);

export const tooManyRequests = (message = 'Too many requests. Please try again shortly.') =>
  new AppError(429, 'rate_limited', message);

export const notImplemented = (message: string) =>
  new AppError(501, 'not_implemented', message);

export const serviceUnavailable = (message: string) =>
  new AppError(503, 'service_unavailable', message);

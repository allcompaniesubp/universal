/**
 * Authentication routes: register, sign in, sign out, session, email
 * verification, and password change.
 */

import { getConfig, usesSecureCookies } from '../config.ts';
import { AppError, badRequest, notFound, unauthorized } from '../http/errors.ts';
import { enforceRateLimit, parseBody, requireUser } from '../http/auth-context.ts';
import type { ApiResponse, ResponseCookie, Router } from '../http/router.ts';
import { RATE_LIMITS } from '../http/rate-limit.ts';
import { CSRF_COOKIE_NAME, createCsrfToken } from '../http/csrf.ts';
import {
  changePassword,
  consumeEmailVerificationToken,
  destroySession,
  loginUser,
  registerUser,
  toPublicUser,
  resolveSession,
} from '../services/auth-service.ts';
import { emailDeliveryConfigured, sendVerificationEmail } from '../services/email-service.ts';
import { loginSchema, registerSchema } from '../validation/schemas.ts';
import { z } from 'zod';
import { resolvePublicOrigin } from '../services/qr-service.ts';
import { MIN_PASSWORD_LENGTH } from '../crypto/password.ts';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

function sessionCookie(token: string, expiresAt: Date): ResponseCookie {
  const config = getConfig();
  return {
    name: config.sessionCookieName,
    value: token,
    options: {
      httpOnly: true,
      secure: usesSecureCookies(config),
      sameSite: 'Lax',
      path: '/',
      expires: expiresAt,
      maxAgeSeconds: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    },
  };
}

function clearedCookie(): ResponseCookie {
  const config = getConfig();
  return {
    name: config.sessionCookieName,
    value: '',
    options: {
      httpOnly: true,
      secure: usesSecureCookies(config),
      sameSite: 'Lax',
      path: '/',
      maxAgeSeconds: 0,
    },
  };
}

/**
 * Issues a fresh CSRF token.
 *
 * Readable by script on purpose: the browser must echo it in a header, which is
 * what makes the double-submit check work. It carries no authority by itself —
 * it is worthless without the session cookie, and worthless to a cross-site
 * page, which cannot read it.
 */
function csrfCookie(token: string): ResponseCookie {
  const config = getConfig();
  return {
    name: CSRF_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: false,
      secure: usesSecureCookies(config),
      sameSite: 'Lax',
      path: '/',
      maxAgeSeconds: 60 * 60 * 12,
    },
  };
}

/** Attaches a cookie to a response without disturbing any other header. */
function withCookie(response: ApiResponse, cookie: ResponseCookie): ApiResponse {
  return withCookies(response, [cookie]);
}

/** Attaches several cookies to a response. */
function withCookies(response: ApiResponse, cookies: ResponseCookie[]): ApiResponse {
  return { ...response, cookies: [...(response.cookies ?? []), ...cookies] };
}

export function registerAuthRoutes(router: Router): void {
  router.post('/api/auth/register', async (request) => {
    enforceRateLimit(request, 'register', RATE_LIMITS.register);
    const input = parseBody(registerSchema, request.body);

    const result = await registerUser(input);

    // The response is decided by deployment configuration alone, never by
    // whether the address already existed. A duplicate therefore produces a
    // byte-identical body to a fresh registration, so the endpoint cannot be
    // used to learn which addresses have accounts.
    const config = getConfig();

    if (!config.emailTransport || config.emailTransport === 'none') {
      return {
        status: 201,
        body: {
          status: 'verification_unavailable',
          message:
            'Your account was created, but this deployment has no email provider configured, so no confirmation link could be sent. Email confirmation is unavailable until an email provider is configured. You can still sign in and use your account; your email address will not be shown as confirmed.',
        },
      };
    }

    // Email is configured. A token exists only for a genuinely new account; for
    // a duplicate there is nothing to send, and the caller cannot tell which
    // case they are in.
    if (result.outcome === 'created' && result.verificationToken) {
      const origin = resolvePublicOrigin(config);
      const verificationUrl = `${origin}/verify-email?token=${encodeURIComponent(result.verificationToken)}`;
      await sendVerificationEmail({
        to: result.user.email,
        fullName: result.user.full_name,
        verificationUrl,
      });
    }

    return {
      status: 201,
      body: {
        status: 'verification_pending',
        message:
          'If that address can receive mail, a confirmation link is on its way. Follow it to finish setting up your account.',
      },
    };
  });

  router.post('/api/auth/login', async (request) => {
    enforceRateLimit(request, 'login', RATE_LIMITS.login);
    const input = parseBody(loginSchema, request.body);

    const outcome = await loginUser({
      email: input.email,
      password: input.password,
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
      ip: request.ip,
    });

    if (!outcome.ok) {
      if (outcome.reason === 'locked') {
        throw new AppError(
          429,
          'account_locked',
          'Too many failed sign-in attempts. This account is temporarily locked.',
        );
      }
      if (outcome.reason === 'disabled') {
        throw unauthorized('This account has been disabled. Please contact support.');
      }
      // One message for both unknown email and wrong password, so the response
      // cannot be used to discover which addresses are registered.
      throw unauthorized('The email address or password is not correct.');
    }

    // The CSRF token is rotated on sign-in so a token observed before
    // authentication cannot be reused afterwards.
    return withCookies(
      { status: 200, body: { user: toPublicUser(outcome.user) } },
      [sessionCookie(outcome.token, outcome.expiresAt), csrfCookie(createCsrfToken())],
    );
  });

  router.post('/api/auth/logout', async (request) => {
    await destroySession(request.cookies[getConfig().sessionCookieName]);
    // The CSRF cookie is cleared alongside the session so a signed-out browser
    // does not keep a stale token.
    return withCookies({ status: 200, body: { ok: true } }, [
      clearedCookie(),
      { ...csrfCookie(''), options: { ...csrfCookie('').options, maxAgeSeconds: 0 } },
    ]);
  });

  /**
   * Issues a CSRF token to the browser.
   *
   * A GET, so it is not itself CSRF-checked. The SPA calls this once at start-up
   * and after sign-in. The token is stored in a script-readable cookie and
   * echoed in the `X-CSRF-Token` header on every state-changing request.
   */
  router.get('/api/auth/csrf', async (request) => {
    enforceRateLimit(request, 'read', RATE_LIMITS.read);
    const existing = request.cookies[CSRF_COOKIE_NAME];
    const token = existing && existing.length > 0 ? existing : createCsrfToken();
    return withCookie({ status: 200, body: { csrfToken: token } }, csrfCookie(token));
  });

  router.get('/api/auth/session', async (request) => {
    const config = getConfig();
    const session = await resolveSession(request.cookies[config.sessionCookieName]);
    if (!session) {
      return { status: 200, body: { user: null } };
    }
    return { status: 200, body: { user: toPublicUser(session.user) } };
  });

  router.post('/api/auth/verify-email', async (request) => {
    enforceRateLimit(request, 'write', RATE_LIMITS.write);
    const body = (request.body ?? {}) as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length === 0) {
      throw badRequest('A verification token is required.');
    }

    const outcome = await consumeEmailVerificationToken(body.token);
    switch (outcome) {
      case 'verified':
        return { status: 200, body: { outcome, message: 'Your email address has been confirmed.' } };
      case 'already_verified':
        return { status: 200, body: { outcome, message: 'This email address was already confirmed.' } };
      case 'expired':
        return { status: 410, body: { outcome, message: 'This verification link has expired.' } };
      case 'invalid':
        throw notFound('That verification link is not valid.');
    }
  });

  router.post('/api/auth/password', async (request) => {
    enforceRateLimit(request, 'passwordChange', RATE_LIMITS.passwordChange);
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    const input = parseBody(changePasswordSchema, request.body);

    await changePassword({
      userId: user.id,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });

    // Every session is destroyed, including this one, so the client must sign
    // in again with the new password.
    return withCookie(
      {
        status: 200,
        body: {
          ok: true,
          message: 'Your password has been changed. Please sign in again.',
        },
      },
      clearedCookie(),
    );
  });

  /** Non-secret configuration the browser needs in order to render honestly. */
  router.get('/api/config/status', async () => ({
    status: 200,
    body: {
      emailDeliveryConfigured: emailDeliveryConfigured(),
      // Phase 2+ surfaces. Reported as disabled so the UI never implies they work.
      paymentsEnabled: false,
      aiToolsEnabled: false,
      listingsEnabled: false,
    },
  }));
}

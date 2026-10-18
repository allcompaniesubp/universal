/**
 * Authentication routes: register, sign in, sign out, session, email
 * verification, and password change.
 */

import { getConfig } from '../config.ts';
import { AppError, badRequest, notFound, unauthorized } from '../http/errors.ts';
import { enforceRateLimit, parseBody, requireUser } from '../http/auth-context.ts';
import type { ApiResponse, ResponseCookie, Router } from '../http/router.ts';
import { RATE_LIMITS } from '../http/rate-limit.ts';
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
      secure: config.isProduction,
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
      secure: config.isProduction,
      sameSite: 'Lax',
      path: '/',
      maxAgeSeconds: 0,
    },
  };
}

/** Attaches a cookie to a response without disturbing any other header. */
function withCookie(response: ApiResponse, cookie: ResponseCookie): ApiResponse {
  return { ...response, cookies: [...(response.cookies ?? []), cookie] };
}

export function registerAuthRoutes(router: Router): void {
  router.post('/api/auth/register', async (request) => {
    enforceRateLimit(request, 'register', RATE_LIMITS.register);
    const input = parseBody(registerSchema, request.body);

    const { user, verificationToken } = await registerUser(input);

    const config = getConfig();
    const origin = resolvePublicOrigin(config, request.origin);
    const verificationUrl = `${origin}/verify-email?token=${encodeURIComponent(verificationToken)}`;

    const delivery = await sendVerificationEmail({
      to: user.email,
      fullName: user.full_name,
      verificationUrl,
    });

    // Honest reporting: when no transport is configured the API says so and
    // returns the link to the account owner. It never claims an email was sent.
    return {
      status: 201,
      body: {
        user: toPublicUser(user),
        emailVerification: delivery.delivered
          ? { delivered: true, transport: delivery.transport }
          : {
              delivered: false,
              reason: 'not_configured',
              message:
                'Email delivery is not configured on this deployment, so no verification email was sent. Use the link below to confirm your address.',
              verificationUrl,
            },
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

    return withCookie(
      { status: 200, body: { user: toPublicUser(outcome.user) } },
      sessionCookie(outcome.token, outcome.expiresAt),
    );
  });

  router.post('/api/auth/logout', async (request) => {
    await destroySession(request.cookies[getConfig().sessionCookieName]);
    return withCookie({ status: 200, body: { ok: true } }, clearedCookie());
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

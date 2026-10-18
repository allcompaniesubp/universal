/**
 * Administrator routes.
 *
 * Authorisation is enforced by reading `users.role` from the database on every
 * request. There is no client-supplied role, no hardcoded administrator
 * password, and no email-address allowlist in code. Elevating a user is a
 * deliberate database operation (see scripts/grant-admin.ts), and it is logged.
 */

import { getConfig } from '../config.ts';
import { badRequest } from '../http/errors.ts';
import { enforceRateLimit, requireRole, requireUser } from '../http/auth-context.ts';
import type { Router } from '../http/router.ts';
import { RATE_LIMITS } from '../http/rate-limit.ts';
import { listAuditEntries } from '../services/audit-service.ts';
import { countUsers, purgeExpiredCredentials } from '../services/auth-service.ts';

export function registerAdminRoutes(router: Router): void {
  router.get('/api/admin/audit', async (request) => {
    enforceRateLimit(request, 'read', RATE_LIMITS.read);
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    requireRole(user, ['admin', 'moderator']);

    const limitRaw = Number(request.query.get('limit') ?? '100');
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
    const entries = await listAuditEntries(limit);
    return { status: 200, body: { entries } };
  });

  /**
   * System status for operators. Reports only configuration presence, never a
   * value: it must be safe to display on an internal dashboard.
   */
  router.get('/api/admin/status', async (request) => {
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    requireRole(user, ['admin', 'moderator']);

    return {
      status: 200,
      body: {
        database: 'connected',
        userCount: await countUsers(),
        emailTransport: config.emailTransport,
        emailDeliveryConfigured: config.emailTransport !== 'none',
        publicBaseUrlConfigured: config.publicBaseUrl !== null,
        // Phase 2+ capability flags. Hard-coded false until the phase ships.
        aiToolsEnabled: false,
        paymentsEnabled: false,
        listingsEnabled: false,
        employmentEnabled: false,
        resourceVaultEnabled: false,
      },
    };
  });

  /** Removes expired sessions and consumed verification tokens. */
  router.post('/api/admin/maintenance/purge', async (request) => {
    enforceRateLimit(request, 'write', RATE_LIMITS.write);
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    requireRole(user, ['admin']);

    const purged = await purgeExpiredCredentials();
    return { status: 200, body: { purged } };
  });

  /**
   * Verification review queue.
   *
   * Phase 1 records only the two automatic levels, so there is nothing a human
   * can approve yet. Rather than showing an empty panel that implies the queue
   * works, the endpoint states plainly that human review lands in Phase 2.
   */
  router.get('/api/admin/verification-queue', async (request) => {
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    requireRole(user, ['admin', 'moderator']);

    return {
      status: 200,
      body: {
        available: false,
        message:
          'Human verification review is not enabled in Phase 1. Only the two automatic levels (profile created, email verified) are recorded. Contact verified, documents reviewed, registry checked and UBP member require a reviewer workflow, which is scheduled for Phase 2.',
        pending: [],
      },
    };
  });

  router.get('/api/admin/health', async (request) => {
    enforceRateLimit(request, 'read', RATE_LIMITS.read);
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    requireRole(user, ['admin', 'moderator']);
    const limitRaw = Number(request.query.get('limit') ?? '10');
    if (!Number.isFinite(limitRaw) || limitRaw < 1) throw badRequest('limit must be a positive number.');
    return { status: 200, body: { ok: true } };
  });
}

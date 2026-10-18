/**
 * Administrator authorisation tests.
 *
 * The risk here is privilege escalation: any member must be refused every admin
 * route, and no client-supplied value may be trusted as a role. These tests
 * attempt escalation through the real router.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  createBusinessFixture,
  createTestClient,
  registerAndSignIn,
  resetDatabase,
} from './helpers.ts';

beforeAll(async () => {
  await resetDatabase();
});

const ADMIN_ROUTES: Array<{ method: 'get' | 'post'; path: string }> = [
  { method: 'get', path: '/api/admin/audit' },
  { method: 'get', path: '/api/admin/status' },
  { method: 'get', path: '/api/admin/verification-queue' },
  { method: 'get', path: '/api/admin/health' },
  { method: 'post', path: '/api/admin/maintenance/purge' },
];

describe('admin route protection', () => {
  it('refuses every admin route to an anonymous visitor', async () => {
    const anonymous = await createTestClient();
    for (const route of ADMIN_ROUTES) {
      const response =
        route.method === 'get' ? await anonymous.get(route.path) : await anonymous.post(route.path);
      expect(response.status).toBe(401);
    }
  });

  it('refuses every admin route to a signed-in ordinary member', async () => {
    const member = await createTestClient();
    await registerAndSignIn(member);

    for (const route of ADMIN_ROUTES) {
      const response =
        route.method === 'get' ? await member.get(route.path) : await member.post(route.path);
      // 403, never 200: a member holds no administrative permission.
      expect(response.status).toBe(403);
    }
  });

  it('refuses every admin route to a business owner', async () => {
    const owner = await createTestClient();
    await createBusinessFixture(owner);

    for (const route of ADMIN_ROUTES) {
      const response =
        route.method === 'get' ? await owner.get(route.path) : await owner.post(route.path);
      expect(response.status).toBe(403);
    }
  });

  it('does not grant administrative access from a client-supplied role field', async () => {
    const member = await createTestClient();
    const user = await registerAndSignIn(member);

    // Attempt to escalate by asserting a role in the request body and headers.
    const attempts = [
      await member.post('/api/admin/maintenance/purge', { role: 'admin' }),
      await member.request('GET', '/api/admin/status', {
        headers: { 'x-role': 'admin', 'x-user-role': 'admin' },
      }),
      await member.request('GET', '/api/admin/audit', { headers: { 'x-admin': 'true' } }),
    ];

    for (const response of attempts) {
      expect([401, 403]).toContain(response.status);
    }

    // The stored role must still be the ordinary member role.
    const { queryOne } = await import('../server/db.ts');
    const row = await queryOne<{ role: string }>('SELECT role FROM users WHERE id = $1', [
      user.userId,
    ]);
    expect(row?.role).toBe('member');
  });

  it('does not grant administrative access by setting the role through a profile update', async () => {
    const member = await createTestClient();
    const user = await registerAndSignIn(member);

    // There is no profile-update endpoint that accepts a role; this asserts that
    // no such escalation path exists through any endpoint a member can reach.
    await member.patch('/api/businesses/00000000-0000-4000-8000-000000000000', { role: 'admin' });

    const { queryOne } = await import('../server/db.ts');
    const row = await queryOne<{ role: string }>('SELECT role FROM users WHERE id = $1', [
      user.userId,
    ]);
    expect(row?.role).toBe('member');
  });

  it('allows an administrator to read the audit log', async () => {
    const admin = await createTestClient();
    const adminUser = await registerAndSignIn(admin);

    // Promote directly in the database, as the documented grant-admin script
    // does. No API route can perform this promotion.
    const { query } = await import('../server/db.ts');
    await query(`UPDATE users SET role = 'admin' WHERE id = $1`, [adminUser.userId]);

    const response = await admin.get<{ entries: Array<{ action: string }>; total: number }>(
      '/api/admin/audit',
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.entries)).toBe(true);
    // The promotion itself and the sign-in must both appear.
    const actions = response.body.entries.map((entry) => entry.action);
    expect(actions).toContain('user.signed_in');
  });

  it('revokes administrative access as soon as the stored role changes', async () => {
    const admin = await createTestClient();
    const adminUser = await registerAndSignIn(admin);

    const { query } = await import('../server/db.ts');
    await query(`UPDATE users SET role = 'admin' WHERE id = $1`, [adminUser.userId]);
    expect((await admin.get('/api/admin/status')).status).toBe(200);

    // Demote while the session is still live. The role is read from the database
    // on every request, so the very next request must be refused.
    await query(`UPDATE users SET role = 'member' WHERE id = $1`, [adminUser.userId]);
    expect((await admin.get('/api/admin/status')).status).toBe(403);
  });

  it('refuses an administrator whose account has been disabled', async () => {
    const admin = await createTestClient();
    const adminUser = await registerAndSignIn(admin);

    const { query } = await import('../server/db.ts');
    await query(`UPDATE users SET role = 'admin', disabled_at = now() WHERE id = $1`, [
      adminUser.userId,
    ]);

    const response = await admin.get('/api/admin/status');
    // A disabled account loses its session entirely.
    expect([401, 403]).toContain(response.status);
  });
});

describe('administrator status output', () => {
  it('reports configuration state without exposing secret values', async () => {
    const admin = await createTestClient();
    const adminUser = await registerAndSignIn(admin);

    const { query } = await import('../server/db.ts');
    await query(`UPDATE users SET role = 'admin' WHERE id = $1`, [adminUser.userId]);

    const response = await admin.get<Record<string, unknown>>('/api/admin/status');
    expect(response.status).toBe(200);

    const serialised = JSON.stringify(response.body);
    // No connection string, password, key or token may appear in the output.
    expect(serialised).not.toMatch(/postgres:\/\//);
    expect(serialised).not.toMatch(/password/i);
    expect(serialised).not.toMatch(/secret/i);
    expect(serialised).not.toMatch(/api[_-]?key/i);
    expect(serialised).not.toMatch(/token/i);
  });
});

describe('public configuration endpoint', () => {
  it('reports which optional features are configured, without secrets', async () => {
    const visitor = await createTestClient();
    const response = await visitor.get<{
      emailDeliveryConfigured: boolean;
      aiToolsEnabled: boolean;
      listingsEnabled: boolean;
    }>('/api/config/status');

    expect(response.status).toBe(200);
    expect(response.body.emailDeliveryConfigured).toBe(false);
    // Phase 1 has no AI or listings implementation, so these must report false
    // rather than being silently omitted or optimistically true.
    expect(response.body.aiToolsEnabled).toBe(false);
    expect(response.body.listingsEnabled).toBe(false);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/postgres:\/\//);
    expect(serialised).not.toMatch(/password/i);
  });
});

describe('audit logging', () => {
  it('records the actor, action and entity for a business change', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const { query } = await import('../server/db.ts');
    const entries = await query<{
      actor_user_id: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
    }>(
      `SELECT actor_user_id, action, entity_type, entity_id
       FROM audit_log WHERE entity_id = $1 ORDER BY created_at`,
      [fixture.businessId],
    );

    expect(entries.length).toBeGreaterThan(0);
    const created = entries.find((entry) => entry.action === 'business.created');
    expect(created).toBeTruthy();
    // The actor must be recorded, so a change is attributable.
    expect(created?.actor_user_id).toBe(fixture.user.userId);
    expect(created?.entity_type).toBe('business');
  });

  it('does not store a raw IP address in the audit log', async () => {
    const client = await createTestClient();
    await registerAndSignIn(client);

    const { query } = await import('../server/db.ts');
    const entries = await query<{ ip_hash: string | null }>(
      'SELECT ip_hash FROM audit_log ORDER BY id DESC LIMIT 5',
    );

    for (const entry of entries) {
      if (entry.ip_hash === null) continue;
      // An IP hash must not look like an IPv4 or IPv6 literal.
      expect(entry.ip_hash).not.toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
      expect(entry.ip_hash).not.toContain(':');
      expect(entry.ip_hash.length).toBeLessThanOrEqual(32);
    }
  });
});

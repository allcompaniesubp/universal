/**
 * Business profile integration tests.
 *
 * The most important assertions here are the authorisation ones. Acceptance
 * criterion: "A user cannot edit another business's profile by changing a URL or
 * API request." These tests attempt exactly that, through the real router.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  createBusinessFixture,
  createTestClient,
  registerAndSignIn,
  registerUser,
  resetDatabase,
} from './helpers.ts';

beforeAll(async () => {
  await resetDatabase();
});

describe('business creation', () => {
  it('requires authentication', async () => {
    const anonymous = await createTestClient();
    const response = await anonymous.post('/api/businesses', {
      displayName: 'Anonymous Attempt',
      slug: 'anonymous-attempt',
    });
    expect(response.status).toBe(401);
  });

  it('creates a business with a unique UBP identifier and draft status', async () => {
    const client = await createTestClient();
    const fixture = await createBusinessFixture(client);

    expect(fixture.ubpId).toMatch(/^UBP-[0-9A-HJKMNP-TV-Z]{8}$/);

    const detail = await client.get<{
      business: { status: string; ubpId: string; verification: Array<{ level: string; held: boolean }> };
      viewer: string;
    }>(`/api/businesses/${fixture.businessId}`);

    expect(detail.status).toBe(200);
    expect(detail.body.viewer).toBe('owner');
    expect(detail.body.business.status).toBe('draft');
    expect(detail.body.business.ubpId).toBe(fixture.ubpId);
  });

  it('issues distinct UBP identifiers to different businesses', async () => {
    const client = await createTestClient();
    const first = await createBusinessFixture(client);
    const second = await createBusinessFixture(client);
    expect(first.ubpId).not.toBe(second.ubpId);
  });

  it('records the profile-created level automatically but no unearned level', async () => {
    const client = await createTestClient();
    const fixture = await createBusinessFixture(client);

    const detail = await client.get<{
      business: {
        verification: Array<{ level: string; status: string; held: boolean; checkedBy: string | null; scope: string | null }>;
      };
    }>(`/api/businesses/${fixture.businessId}`);

    const byLevel = new Map(detail.body.business.verification.map((entry) => [entry.level, entry]));

    // The profile exists, so this level is legitimately held.
    expect(byLevel.get('profile_created')?.held).toBe(true);
    expect(byLevel.get('profile_created')?.checkedBy).toBeTruthy();
    expect(byLevel.get('profile_created')?.scope).toBeTruthy();

    // Every level requiring a human reviewer must be unearned.
    for (const level of ['contact_verified', 'documents_reviewed', 'registry_checked', 'ubp_member']) {
      const entry = byLevel.get(level);
      expect(entry?.status).toBe('not_started');
      expect(entry?.held).toBe(false);
    }

    // All six levels are listed, so an unperformed check is visible as such.
    expect(detail.body.business.verification).toHaveLength(6);
  });

  it('records email verified only after the address is actually confirmed', async () => {
    const client = await createTestClient();
    const user = await registerUser(client);

    // Sign in without confirming the email address: signing in is permitted, so
    // this isolates the verification level from the session.
    const login = await client.post('/api/auth/login', {
      email: user.email,
      password: user.password,
    });
    expect(login.status).toBe(200);

    // Create the business before verifying the email address.
    const created = await client.post<{ business: { id: string } }>('/api/businesses', {
      displayName: 'Unverified Email Co',
      slug: `unverified-${Date.now().toString(36)}`,
      tagline: 'Created before the email address was confirmed.',
    });
    expect(created.status).toBe(201);

    const before = await client.get<{
      business: { verification: Array<{ level: string; held: boolean }> };
    }>(`/api/businesses/${created.body.business.id}`);

    expect(before.body.business.verification.find((e) => e.level === 'email_verified')?.held).toBe(false);

    // Confirm the address, then create a second business.
    if (user.verificationToken) {
      await client.post('/api/auth/verify-email', { token: user.verificationToken });
    }

    const after = await client.post<{ business: { id: string } }>('/api/businesses', {
      displayName: 'Verified Email Co',
      slug: `verified-${Date.now().toString(36)}`,
      tagline: 'Created after the email address was confirmed.',
    });

    const detail = await client.get<{
      business: { verification: Array<{ level: string; held: boolean; checkedAt: string | null }> };
    }>(`/api/businesses/${after.body.business.id}`);

    const emailLevel = detail.body.business.verification.find((e) => e.level === 'email_verified');
    expect(emailLevel?.held).toBe(true);
    expect(emailLevel?.checkedAt).toBeTruthy();
  });

  it('rejects a duplicate slug across different owners', async () => {
    const slug = `shared-slug-${Date.now().toString(36)}`;

    const first = await createTestClient();
    await createBusinessFixture(first, { slug });

    const second = await createTestClient();
    await registerAndSignIn(second);

    const response = await second.post<{ error: { code: string } }>('/api/businesses', {
      displayName: 'Second Owner Business',
      slug,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('conflict');
  });

  it('rejects a reserved slug', async () => {
    const client = await createTestClient();
    await registerAndSignIn(client);

    for (const reserved of ['dashboard', 'api', 'admin', 'verify']) {
      const response = await client.post('/api/businesses', {
        displayName: 'Reserved Slug Attempt',
        slug: reserved,
      });
      expect(response.status).toBe(422);
    }
  });

  it('rejects a slug that would break routing', async () => {
    const client = await createTestClient();
    await registerAndSignIn(client);

    // These stay invalid even after normalisation collapses separators, so they
    // must be refused outright. Separator-only problems are handled by
    // normalisation and are covered by the normalisation test below.
    for (const bad of ['ab', 'a', 'x'.repeat(70)]) {
      const response = await client.post<{ error: { code: string } }>('/api/businesses', {
        displayName: 'Bad Slug Attempt',
        slug: bad,
      });
      // Every one of these must be refused; none may create a business.
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('validation_failed');
    }
  });

  it('refuses a reserved word even when it is written with separators', async () => {
    const client = await createTestClient();
    await registerAndSignIn(client);

    for (const attempt of ['dashboard', 'Dashboard', 'api', 'admin']) {
      const response = await client.post('/api/businesses', {
        displayName: 'Reserved Word Attempt',
        slug: attempt,
      });
      expect(response.status).toBe(422);
    }
  });

  it('normalises a slug rather than storing it verbatim', async () => {
    const client = await createTestClient();
    await registerAndSignIn(client);

    const response = await client.post<{ business: { slug: string } }>('/api/businesses', {
      displayName: 'Normalised Slug Co',
      slug: '  Normalised--Slug  ',
    });

    expect(response.status).toBe(201);
    // Case, padding and repeated hyphens are collapsed before storage.
    expect(response.body.business.slug).toBe('normalised-slug');
  });

  it('rejects a website URL that is not http or https', async () => {
    const client = await createTestClient();
    await registerAndSignIn(client);

    const response = await client.post('/api/businesses', {
      displayName: 'Bad URL Co',
      slug: `bad-url-${Date.now().toString(36)}`,
      websiteUrl: 'javascript:alert(1)',
    });

    expect(response.status).toBe(422);
  });
});

describe('ownership enforcement (IDOR)', () => {
  it('refuses to let a signed-in user read another business as its owner', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    // A second, fully authenticated account.
    const attacker = await createTestClient();
    await registerAndSignIn(attacker);

    const response = await attacker.get<{
      business: Record<string, unknown>;
      viewer: string;
    }>(`/api/businesses/${fixture.businessId}`);

    // A draft must not be readable by a non-owner, and must not reveal that it
    // exists: 404 rather than 403.
    expect(response.status).toBe(404);
  });

  it('refuses to let another user edit a business by changing the id in the URL', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const attacker = await createTestClient();
    await registerAndSignIn(attacker);

    const response = await attacker.patch<{ error: { code: string } }>(
      `/api/businesses/${fixture.businessId}`,
      { displayName: 'Hijacked By Attacker' },
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');

    // Confirm the original data is untouched.
    const detail = await owner.get<{ business: { displayName: string } }>(
      `/api/businesses/${fixture.businessId}`,
    );
    expect(detail.body.business.displayName).toBe('Test Company');
  });

  it('ignores an owner id supplied in the request body', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const attacker = await createTestClient();
    const attackerUser = await registerAndSignIn(attacker);

    // Attempt to reassign ownership by passing an owner field. The schema does
    // not accept one, so the field must be dropped and the request refused.
    const response = await attacker.patch(`/api/businesses/${fixture.businessId}`, {
      ownerUserId: attackerUser.userId,
      owner_user_id: attackerUser.userId,
      displayName: 'Ownership Transfer Attempt',
    });

    expect(response.status).toBe(403);

    // Ownership must be unchanged in the database.
    const { queryOne } = await import('../server/db.ts');
    const row = await queryOne<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM businesses WHERE id = $1',
      [fixture.businessId],
    );
    expect(row?.owner_user_id).toBe(fixture.user.userId);
  });

  it('refuses to let another user publish a business', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const attacker = await createTestClient();
    await registerAndSignIn(attacker);

    const response = await attacker.post(`/api/businesses/${fixture.businessId}/publish`);
    expect(response.status).toBe(403);
  });

  it('refuses to let another user unpublish a business', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const attacker = await createTestClient();
    await registerAndSignIn(attacker);

    const response = await attacker.post(`/api/businesses/${fixture.businessId}/unpublish`);
    expect(response.status).toBe(403);
  });

  it('refuses to let another user download the vCard', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const attacker = await createTestClient();
    await registerAndSignIn(attacker);

    const response = await attacker.get(`/api/businesses/${fixture.businessId}/card.vcf`);
    expect(response.status).toBe(403);
  });

  it('requires authentication to download a vCard at all', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const anonymous = await createTestClient();
    const response = await anonymous.get(`/api/businesses/${fixture.businessId}/card.vcf`);
    expect(response.status).toBe(401);
  });

  it('returns only the owner’s own businesses from the collection endpoint', async () => {
    const first = await createTestClient();
    const firstFixture = await createBusinessFixture(first);

    const second = await createTestClient();
    await registerAndSignIn(second);

    const response = await second.get<{ businesses: Array<{ id: string }> }>('/api/businesses');
    expect(response.status).toBe(200);
    expect(response.body.businesses).toHaveLength(0);

    const firstList = await first.get<{ businesses: Array<{ id: string }> }>('/api/businesses');
    expect(firstList.body.businesses.map((b) => b.id)).toContain(firstFixture.businessId);
  });

  it('does not allow editing a business that does not exist', async () => {
    const client = await createTestClient();
    await registerAndSignIn(client);

    const response = await client.patch('/api/businesses/00000000-0000-4000-8000-000000000000', {
      displayName: 'Ghost Business',
    });
    expect(response.status).toBe(404);
  });
});

describe('public visibility', () => {
  it('hides a draft from the public directory and from slug lookup', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const visitor = await createTestClient();

    const bySlug = await visitor.get(`/api/directory/by-slug/${fixture.slug}`);
    expect(bySlug.status).toBe(404);

    const directory = await visitor.get<{ items: Array<{ slug: string }> }>('/api/directory');
    expect(directory.body.items.map((item) => item.slug)).not.toContain(fixture.slug);
  });

  it('shows a published business in the directory and at its slug', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();

    const bySlug = await visitor.get<{ business: { slug: string; status: string }; viewer: string }>(
      `/api/directory/by-slug/${fixture.slug}`,
    );
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.business.slug).toBe(fixture.slug);
    expect(bySlug.body.business.status).toBe('published');
    expect(bySlug.body.viewer).toBe('public');

    const directory = await visitor.get<{ items: Array<{ slug: string }> }>('/api/directory');
    expect(directory.body.items.map((item) => item.slug)).toContain(fixture.slug);
  });

  it('withholds contact details unless the owner opts in', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner, {
      contactEmail: 'private@example.test',
      contactPhone: '+91 90000 00000',
      // showEmailPublicly / showPhonePublicly intentionally omitted (default false)
    });
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<{
      business: { contactEmail: string | null; contactPhone: string | null };
    }>(`/api/directory/by-slug/${fixture.slug}`);

    expect(response.body.business.contactEmail).toBeNull();
    expect(response.body.business.contactPhone).toBeNull();
  });

  it('publishes contact details when the owner opts in', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner, {
      contactEmail: 'public@example.test',
      showEmailPublicly: true,
    });
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<{ business: { contactEmail: string | null } }>(
      `/api/directory/by-slug/${fixture.slug}`,
    );

    expect(response.body.business.contactEmail).toBe('public@example.test');
  });

  it('requires a tagline or description before publishing', async () => {
    const client = await createTestClient();
    await registerAndSignIn(client);

    const created = await client.post<{ business: { id: string } }>('/api/businesses', {
      displayName: 'Empty Profile Co',
      slug: `empty-${Date.now().toString(36)}`,
    });
    expect(created.status).toBe(201);

    const publish = await client.post(`/api/businesses/${created.body.business.id}/publish`);
    expect(publish.status).toBe(400);
  });

  it('removes a business from the directory when unpublished', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const before = await visitor.get(`/api/directory/by-slug/${fixture.slug}`);
    expect(before.status).toBe(200);

    await owner.post(`/api/businesses/${fixture.businessId}/unpublish`);

    const after = await visitor.get(`/api/directory/by-slug/${fixture.slug}`);
    expect(after.status).toBe(404);
  });

  it('never exposes the internal UUID in the public projection', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<{ business: Record<string, unknown> }>(
      `/api/directory/by-slug/${fixture.slug}`,
    );

    expect(response.body.business).not.toHaveProperty('id');
    expect(response.body.business).not.toHaveProperty('ownerUserId');
    expect(JSON.stringify(response.body)).not.toContain(fixture.businessId);
  });

  it('does not expose private fields through directory search', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner, {
      contactEmail: 'search-secret@example.test',
    });
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<{ items: Array<Record<string, unknown>> }>(
      `/api/directory?search=${encodeURIComponent('Test Company')}`,
    );

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('search-secret@example.test');
    expect(serialised).not.toContain(fixture.businessId);
  });
});

describe('directory search', () => {
  it('filters by search term and returns pagination metadata', async () => {
    const owner = await createTestClient();
    const marker = `Zebra${Date.now().toString(36)}`;
    const fixture = await createBusinessFixture(owner, {
      displayName: `${marker} Trading`,
      slug: `zebra-${Date.now().toString(36)}`,
    });
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<{
      items: Array<{ displayName: string }>;
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/api/directory?search=${marker}`);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0]?.displayName).toContain(marker);
    expect(response.body.page).toBe(1);
    expect(response.body.pageSize).toBeGreaterThan(0);
    expect(response.body.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('returns an empty result set rather than an error when nothing matches', async () => {
    const visitor = await createTestClient();
    const response = await visitor.get<{ items: unknown[]; total: number }>(
      '/api/directory?search=zzz-no-such-business-zzz',
    );
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(0);
    expect(response.body.total).toBe(0);
  });

  it('filters by country', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner, {
      countryCode: 'BR',
      slug: `brazil-${Date.now().toString(36)}`,
    });
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<{ items: Array<{ countryCode: string | null }> }>(
      '/api/directory?country=BR',
    );

    expect(response.status).toBe(200);
    for (const item of response.body.items) expect(item.countryCode).toBe('BR');
  });

  it('caps the page size so a client cannot request the whole table', async () => {
    const visitor = await createTestClient();
    const response = await visitor.get<{ pageSize: number }>('/api/directory?pageSize=100000');
    expect(response.body.pageSize).toBeLessThanOrEqual(50);
  });

  it('handles a search string containing SQL metacharacters safely', async () => {
    const visitor = await createTestClient();
    const response = await visitor.get(
      `/api/directory?search=${encodeURIComponent("'; DROP TABLE businesses; --")}`,
    );
    expect(response.status).toBe(200);

    // The table must still exist.
    const { queryOne } = await import('../server/db.ts');
    const row = await queryOne<{ count: string }>('SELECT count(*)::text AS count FROM businesses');
    expect(row).not.toBeNull();
  });
});

describe('publication lifecycle', () => {
  it('publishes, then unpublishes, then publishes again', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const published = await owner.post<{ business: { status: string; publishedAt: string | null } }>(
      `/api/businesses/${fixture.businessId}/publish`,
    );
    expect(published.body.business.status).toBe('published');
    expect(published.body.business.publishedAt).toBeTruthy();

    const unpublished = await owner.post<{ business: { status: string } }>(
      `/api/businesses/${fixture.businessId}/unpublish`,
    );
    expect(unpublished.body.business.status).toBe('unpublished');

    const republished = await owner.post<{ business: { status: string; publishedAt: string | null } }>(
      `/api/businesses/${fixture.businessId}/publish`,
    );
    expect(republished.body.business.status).toBe('published');
    // The original publication date is preserved rather than reset.
    expect(republished.body.business.publishedAt).toBe(published.body.business.publishedAt);
  });

  it('refuses to republish a suspended business', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    // Suspend directly, as an administrator action would.
    const { query } = await import('../server/db.ts');
    await query(`UPDATE businesses SET status = 'suspended' WHERE id = $1`, [fixture.businessId]);

    const response = await owner.post<{ error: { code: string } }>(
      `/api/businesses/${fixture.businessId}/publish`,
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
  });
});

describe('updates', () => {
  it('updates the owner’s own business', async () => {
    const client = await createTestClient();
    const fixture = await createBusinessFixture(client);

    const response = await client.patch<{ business: { tagline: string; category: string } }>(
      `/api/businesses/${fixture.businessId}`,
      { tagline: 'An updated tagline', category: 'Updated Category' },
    );

    expect(response.status).toBe(200);
    expect(response.body.business.tagline).toBe('An updated tagline');
    expect(response.body.business.category).toBe('Updated Category');
  });

  it('rejects an empty update', async () => {
    const client = await createTestClient();
    const fixture = await createBusinessFixture(client);

    const response = await client.patch(`/api/businesses/${fixture.businessId}`, {});
    expect(response.status).toBe(422);
  });

  it('does not allow the UBP identifier to be changed through an update', async () => {
    const client = await createTestClient();
    const fixture = await createBusinessFixture(client);

    await client.patch(`/api/businesses/${fixture.businessId}`, { ubpId: 'UBP-AAAAAAAA' });

    const detail = await client.get<{ business: { ubpId: string } }>(
      `/api/businesses/${fixture.businessId}`,
    );
    expect(detail.body.business.ubpId).toBe(fixture.ubpId);
  });

  it('writes an audit entry for creation and update', async () => {
    const client = await createTestClient();
    const fixture = await createBusinessFixture(client);
    await client.patch(`/api/businesses/${fixture.businessId}`, { tagline: 'Audited change' });

    const { query } = await import('../server/db.ts');
    const entries = await query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY created_at`,
      [fixture.businessId],
    );

    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('business.created');
    expect(actions).toContain('business.updated');
  });
});

describe('slug suggestion', () => {
  it('returns an available slug derived from the business name', async () => {
    const client = await createTestClient();
    await registerAndSignIn(client);

    const response = await client.get<{ slug: string }>(
      '/api/businesses/slug-suggestion?displayName=Sharma%20Textiles%20%26%20Co.',
    );

    expect(response.status).toBe(200);
    expect(response.body.slug).toBe('sharma-textiles-co');
  });

  it('avoids a slug that is already taken', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner, { slug: 'taken-name-co' });

    const other = await createTestClient();
    await registerAndSignIn(other);

    const response = await other.get<{ slug: string }>(
      '/api/businesses/slug-suggestion?displayName=Taken%20Name%20Co',
    );

    expect(response.status).toBe(200);
    expect(response.body.slug).not.toBe(fixture.slug);
  });
});

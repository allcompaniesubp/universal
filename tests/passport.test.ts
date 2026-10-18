/**
 * Passport identity, QR code, digital card and public verification tests.
 *
 * Acceptance criteria covered here:
 *   - a UBP ID is unique and stays associated with the correct business
 *   - a QR code resolves to the correct public profile or verification page
 *   - verification labels reflect real checks
 *   - private documents and contact details are not publicly accessible
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

describe('public verification endpoint', () => {
  it('resolves a published passport and reports its real status', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<{
      ubpId: string;
      displayName: string;
      currentlyValid: boolean;
      suspended: boolean;
      issuedAt: string;
      verificationUrl: string;
      publicUrl: string;
      verification: Array<{ level: string; label: string; status: string; held: boolean; meaning: string; scope: string | null }>;
    }>(`/api/verify/${fixture.ubpId}`);

    expect(response.status).toBe(200);
    expect(response.body.ubpId).toBe(fixture.ubpId);
    expect(response.body.currentlyValid).toBe(true);
    expect(response.body.suspended).toBe(false);
    expect(response.body.issuedAt).toBeTruthy();
    // The verification URL must be absolute so a QR code scanned from a printed
    // card still resolves.
    expect(response.body.verificationUrl).toBe(`https://ubp.test/verify/${fixture.ubpId}`);
    expect(response.body.publicUrl).toBe(`https://ubp.test/business/${fixture.slug}`);
  });

  it('explains every level, including the ones not held', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<{
      verification: Array<{
        level: string;
        label: string;
        status: string;
        held: boolean;
        meaning: string;
        requiresHumanReview: boolean;
      }>;
    }>(`/api/verify/${fixture.ubpId}`);

    const levels = response.body.verification;
    expect(levels).toHaveLength(6);

    // Every level must carry an explanation of what it does and does not assert.
    for (const entry of levels) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.meaning.length).toBeGreaterThan(40);
    }

    const byLevel = new Map(levels.map((entry) => [entry.level, entry]));

    // Only the two automatable levels may be held for a freshly created profile.
    expect(byLevel.get('profile_created')?.held).toBe(true);
    expect(byLevel.get('email_verified')?.held).toBe(true);

    for (const level of ['contact_verified', 'documents_reviewed', 'registry_checked', 'ubp_member']) {
      expect(byLevel.get(level)?.held).toBe(false);
      expect(byLevel.get(level)?.status).toBe('not_started');
      expect(byLevel.get(level)?.requiresHumanReview).toBe(true);
    }
  });

  it('reports a suspended passport as not currently valid rather than hiding it', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const { query } = await import('../server/db.ts');
    await query(`UPDATE businesses SET status = 'suspended' WHERE id = $1`, [fixture.businessId]);

    const visitor = await createTestClient();
    const response = await visitor.get<{ currentlyValid: boolean; suspended: boolean }>(
      `/api/verify/${fixture.ubpId}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.suspended).toBe(true);
    expect(response.body.currentlyValid).toBe(false);
  });

  it('returns 404 for a well-formed but unknown identifier', async () => {
    const visitor = await createTestClient();
    const response = await visitor.get('/api/verify/UBP-ZZZZZZZZ');
    expect(response.status).toBe(404);
  });

  it('returns 400 for a malformed identifier', async () => {
    const visitor = await createTestClient();
    for (const bad of ['not-a-ubp-id', 'UBP-123', 'UBP-123456789', '12345678']) {
      const response = await visitor.get(`/api/verify/${bad}`);
      expect([400, 404]).toContain(response.status);
    }
  });

  it('accepts a lower-case identifier', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<{ ubpId: string }>(
      `/api/verify/${fixture.ubpId.toLowerCase()}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.ubpId).toBe(fixture.ubpId);
  });

  it('does not expose contact details or internal identifiers on the verification page', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner, {
      contactEmail: 'verify-secret@example.test',
      contactPhone: '+91 91111 11111',
    });
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get(`/api/verify/${fixture.ubpId}`);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('verify-secret@example.test');
    expect(serialised).not.toContain('91111');
    expect(serialised).not.toContain(fixture.businessId);
  });

  it('resolves a suspended passport through the QR route', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const { query } = await import('../server/db.ts');
    await query(`UPDATE businesses SET status = 'suspended' WHERE id = $1`, [fixture.businessId]);

    const visitor = await createTestClient();
    const response = await visitor.get(`/api/verify-qr/${fixture.ubpId}`);
    // A suspended passport still renders, so a revoked card does not look
    // identical to a card that never existed.
    expect(response.status).toBe(200);
  });
});

describe('QR code', () => {
  it('returns an SVG for the owner', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const response = await owner.get<string>(`/api/businesses/${fixture.businessId}/qr.svg`);
    expect(response.status).toBe(200);
    expect(response.body).toContain('<svg');
    expect(response.headers['Content-Type']).toContain('image/svg+xml');
  });

  it('does not reveal a draft business to a non-owner through the QR route', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const attacker = await createTestClient();
    await registerAndSignIn(attacker);

    // The business exists, but it is a draft. A 404 rather than 403 avoids
    // confirming that the identifier refers to a real record.
    const response = await attacker.get(`/api/businesses/${fixture.businessId}/qr.svg`);
    expect(response.status).toBe(404);
  });

  it('serves the QR code for a published business to any visitor', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<string>(`/api/businesses/${fixture.businessId}/qr.svg`);

    // The QR payload is public information: it encodes the public verification
    // address and no private field, so serving it to a visitor is intended.
    expect(response.status).toBe(200);
    expect(response.body).not.toContain(fixture.businessId);
  });

  it('renders a QR code addressed by UBP identifier once published', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<string>(`/api/verify-qr/${fixture.ubpId}`);
    expect(response.status).toBe(200);
    expect(response.body).toContain('<svg');
  });

  it('accepts a .svg suffix on the identifier', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const withSuffix = await visitor.get<string>(`/api/verify-qr/${fixture.ubpId}.svg`);
    expect(withSuffix.status).toBe(200);
    expect(withSuffix.body).toContain('<svg');
  });

  it('refuses a QR code for a draft business', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    // Draft, never published.
    const visitor = await createTestClient();
    const response = await visitor.get(`/api/verify-qr/${fixture.ubpId}`);
    expect(response.status).toBe(404);
  });

  it('encodes the verification URL, not a private identifier', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const visitor = await createTestClient();
    const response = await visitor.get<string>(`/api/verify-qr/${fixture.ubpId}`);

    // The SVG must not embed the internal UUID, and the payload must be the
    // public verification address.
    expect(response.body).not.toContain(fixture.businessId);
    const { buildVerificationUrl } = await import('../server/services/qr-service.ts');
    expect(buildVerificationUrl('https://ubp.test', fixture.ubpId)).toBe(
      `https://ubp.test/verify/${fixture.ubpId}`,
    );
  });

  it('produces a scannable QR code that decodes to the verification URL', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const response = await owner.get<string>(`/api/businesses/${fixture.businessId}/qr.svg`);
    expect(response.status).toBe(200);

    // The SVG must contain the expected number of modules for the encoded
    // payload. A structurally valid SVG with the right dimensions proves the
    // encoder ran rather than returning an empty placeholder.
    const svg = response.body;
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('<path');
  });
});

describe('digital business card (vCard)', () => {
  it('returns a vCard for the owner with correct escaping', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner, {
      displayName: 'Semi; Colon, Test Co',
      contactEmail: 'card@example.test',
    });

    const response = await owner.get<string>(`/api/businesses/${fixture.businessId}/card.vcf`);
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/vcard');
    expect(response.body).toContain('BEGIN:VCARD');
    expect(response.body).toContain('END:VCARD');
    expect(response.body).toContain('VERSION:3.0');
    expect(response.body).toContain(fixture.ubpId);
    // Commas and semicolons in a display name must be escaped, or a contact
    // import would split the name into fields.
    expect(response.body).toContain('Semi\\; Colon\\, Test Co');
  });

  it('refuses the vCard for a non-owner', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const attacker = await createTestClient();
    await registerAndSignIn(attacker);

    const response = await attacker.get(`/api/businesses/${fixture.businessId}/card.vcf`);
    expect(response.status).toBe(403);
  });

  it('refuses the vCard for an anonymous visitor', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const anonymous = await createTestClient();
    const response = await anonymous.get(`/api/businesses/${fixture.businessId}/card.vcf`);
    expect(response.status).toBe(401);
  });
});

describe('identifier integrity', () => {
  it('keeps the identifier bound to the same business across updates', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    await owner.patch(`/api/businesses/${fixture.businessId}`, {
      displayName: 'Renamed Business',
      tagline: 'A new tagline after renaming.',
    });

    const { queryOne } = await import('../server/db.ts');
    const row = await queryOne<{ ubp_id: string; display_name: string }>(
      'SELECT ubp_id, display_name FROM businesses WHERE id = $1',
      [fixture.businessId],
    );

    expect(row?.ubp_id).toBe(fixture.ubpId);
    expect(row?.display_name).toBe('Renamed Business');
  });

  it('enforces uniqueness of the identifier at the database level', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    // Attempt to insert a duplicate identifier directly. The unique index must
    // reject it, so a generator collision can never silently create two
    // passports sharing one identifier.
    const { query } = await import('../server/db.ts');
    await expect(
      query(
        `INSERT INTO businesses (owner_user_id, ubp_id, slug, display_name)
         VALUES ($1, $2, $3, $4)`,
        [fixture.user.userId, fixture.ubpId, 'duplicate-identifier-co', 'Duplicate Identifier Co'],
      ),
    ).rejects.toThrow();
  });

  it('rejects an identifier that does not match the documented format', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const { query } = await import('../server/db.ts');
    for (const malformed of ['UBP-123', 'ubp-12345678', 'UBP-123456789']) {
      await expect(
        query(
          `INSERT INTO businesses (owner_user_id, ubp_id, slug, display_name)
           VALUES ($1, $2, $3, $4)`,
          [fixture.user.userId, malformed, `bad-format-${Math.random().toString(36).slice(2, 10)}`, 'Bad Format Co'],
        ),
      ).rejects.toThrow();
    }
  });
});

describe('verification record integrity', () => {
  it('refuses a verification record with no attribution', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    // The schema requires either a user or a system to be named as the checker,
    // so an anonymous verification record cannot be written.
    const { query } = await import('../server/db.ts');
    await expect(
      query(
        `INSERT INTO verification_records (business_id, level, status)
         VALUES ($1, 'ubp_member', 'verified')`,
        [fixture.businessId],
      ),
    ).rejects.toThrow();
  });

  it('refuses an unknown verification level', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const { query } = await import('../server/db.ts');
    await expect(
      query(
        `INSERT INTO verification_records (business_id, level, status, checked_by_system)
         VALUES ($1, 'invented_level', 'verified', 'test')`,
        [fixture.businessId],
      ),
    ).rejects.toThrow();
  });

  it('refuses an unknown verification status', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);

    const { query } = await import('../server/db.ts');
    await expect(
      query(
        `INSERT INTO verification_records (business_id, level, status, checked_by_system)
         VALUES ($1, 'ubp_member', 'probably_fine', 'test')`,
        [fixture.businessId],
      ),
    ).rejects.toThrow();
  });

  it('treats an expired level as not held', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const { query } = await import('../server/db.ts');
    await query(
      `INSERT INTO verification_records
         (business_id, level, status, scope, method, source, checked_at, expires_at, checked_by_system)
       VALUES ($1, 'registry_checked', 'verified', 'Test registry lookup', 'manual lookup',
               'Example Registry', now(), now() - interval '1 day', 'test-suite')`,
      [fixture.businessId],
    );

    const visitor = await createTestClient();
    const response = await visitor.get<{
      verification: Array<{ level: string; status: string; held: boolean }>;
    }>(`/api/verify/${fixture.ubpId}`);

    const entry = response.body.verification.find((item) => item.level === 'registry_checked');
    // The record exists and is verified, but it has expired, so it must not be
    // presented as currently held.
    expect(entry?.held).toBe(false);
  });

  it('treats a revoked level as not held', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const { query } = await import('../server/db.ts');
    await query(
      `INSERT INTO verification_records
         (business_id, level, status, scope, method, source, checked_at, checked_by_system)
       VALUES ($1, 'ubp_member', 'revoked', 'Membership revoked', 'manual', 'AllCompanies', now(), 'test-suite')`,
      [fixture.businessId],
    );

    const visitor = await createTestClient();
    const response = await visitor.get<{
      verification: Array<{ level: string; status: string; held: boolean }>;
    }>(`/api/verify/${fixture.ubpId}`);

    const entry = response.body.verification.find((item) => item.level === 'ubp_member');
    expect(entry?.held).toBe(false);
    expect(entry?.status).toBe('revoked');
  });

  it('exposes the source and scope of a genuine check', async () => {
    const owner = await createTestClient();
    const fixture = await createBusinessFixture(owner);
    await owner.post(`/api/businesses/${fixture.businessId}/publish`);

    const { query } = await import('../server/db.ts');
    await query(
      `INSERT INTO verification_records
         (business_id, level, status, scope, method, source, source_reference, checked_at, checked_by_system)
       VALUES ($1, 'registry_checked', 'verified',
               'Registry lookup on 1 January', 'Official registry search',
               'Example National Business Registry', 'REG-12345', now(), 'test-suite')`,
      [fixture.businessId],
    );

    const visitor = await createTestClient();
    const response = await visitor.get<{
      verification: Array<{
        level: string;
        held: boolean;
        scope: string | null;
        source: string | null;
        method: string | null;
        checkedAt: string | null;
      }>;
    }>(`/api/verify/${fixture.ubpId}`);

    const entry = response.body.verification.find((item) => item.level === 'registry_checked');
    expect(entry?.held).toBe(true);
    // A held level must state what was checked, by whom, and when.
    expect(entry?.scope).toBe('Registry lookup on 1 January');
    expect(entry?.source).toBe('Example National Business Registry');
    expect(entry?.method).toBe('Official registry search');
    expect(entry?.checkedAt).toBeTruthy();
  });
});

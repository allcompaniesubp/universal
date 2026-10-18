/**
 * Business profiles: creation, editing, publication and public reads.
 *
 * Ownership rule: every mutation resolves the caller's identity from the
 * database session and compares it with `businesses.owner_user_id`. The owner
 * id is never read from the request body, query string or a header, so changing
 * an id in a URL or API call cannot grant access to another business.
 */

import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../db.ts';
import { generateUbpId } from '../domain/ubp-id.ts';
import { checkSlug, normaliseSlug, suggestSlug } from '../domain/slug.ts';
import {
  LEVEL_DEFINITION_BY_KEY,
  VERIFICATION_LEVELS,
  isCurrentlyHeld,
  type VerificationLevel,
  type VerificationStatus,
} from '../domain/verification.ts';
import { badRequest, conflict, forbidden, notFound, validationFailed } from '../http/errors.ts';
import type { CreateBusinessInput, UpdateBusinessInput } from '../validation/schemas.ts';

export type BusinessStatus = 'draft' | 'published' | 'unpublished' | 'suspended';

export interface BusinessRow {
  id: string;
  owner_user_id: string;
  ubp_id: string;
  slug: string;
  display_name: string;
  legal_name: string | null;
  tagline: string | null;
  description: string | null;
  category: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  website_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  logo_url: string | null;
  banner_url: string | null;
  languages: string[];
  status: BusinessStatus;
  show_email_publicly: boolean;
  show_phone_publicly: boolean;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface VerificationEntry {
  level: VerificationLevel;
  label: string;
  meaning: string;
  /** `not_started` means no check has been recorded for this level yet. */
  status: VerificationStatus | 'not_started';
  held: boolean;
  scope: string | null;
  method: string | null;
  source: string | null;
  checkedAt: string | null;
  expiresAt: string | null;
  checkedBy: string | null;
}

/** Full business representation, including fields the owner controls. */
export interface BusinessDetail {
  id: string;
  ubpId: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  tagline: string | null;
  description: string | null;
  category: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  languages: string[];
  status: BusinessStatus;
  showEmailPublicly: boolean;
  showPhonePublicly: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  verification: VerificationEntry[];
}

/**
 * Public projection. Contact details are withheld unless the owner opted in,
 * and are never included for a business that is not published.
 */
export interface PublicBusiness {
  ubpId: string;
  slug: string;
  displayName: string;
  tagline: string | null;
  description: string | null;
  category: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  languages: string[];
  status: BusinessStatus;
  publishedAt: string | null;
  createdAt: string;
  verification: VerificationEntry[];
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

export function toBusinessDetail(row: BusinessRow, verification: VerificationEntry[]): BusinessDetail {
  return {
    id: row.id,
    ubpId: row.ubp_id,
    slug: row.slug,
    displayName: row.display_name,
    legalName: row.legal_name,
    tagline: row.tagline,
    description: row.description,
    category: row.category,
    countryCode: row.country_code,
    region: row.region,
    city: row.city,
    websiteUrl: row.website_url,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    languages: row.languages,
    status: row.status,
    showEmailPublicly: row.show_email_publicly,
    showPhonePublicly: row.show_phone_publicly,
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    verification,
  };
}

export function toPublicBusiness(row: BusinessRow, verification: VerificationEntry[]): PublicBusiness {
  const contactVisible = row.status === 'published';
  return {
    ubpId: row.ubp_id,
    slug: row.slug,
    displayName: row.display_name,
    tagline: row.tagline,
    description: row.description,
    category: row.category,
    countryCode: row.country_code,
    region: row.region,
    city: row.city,
    websiteUrl: row.website_url,
    contactEmail: contactVisible && row.show_email_publicly ? row.contact_email : null,
    contactPhone: contactVisible && row.show_phone_publicly ? row.contact_phone : null,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    languages: row.languages,
    status: row.status,
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    verification,
  };
}

// ---------------------------------------------------------------------------
// Verification assembly
// ---------------------------------------------------------------------------

interface VerificationRecordRow {
  level: VerificationLevel;
  status: VerificationStatus;
  scope: string | null;
  method: string | null;
  source: string | null;
  checked_at: Date;
  expires_at: Date | null;
  checked_by_user_id: string | null;
  checked_by_system: string | null;
}

/**
 * Builds the verification view for a business.
 *
 * Every level is always listed, so an unperformed check is visibly
 * "not started" rather than silently omitted. The most recent record per level
 * is authoritative; a level whose latest record is not `verified`, or has
 * expired, is reported as not held.
 */
export async function loadVerification(businessId: string): Promise<VerificationEntry[]> {
  const rows = await query<VerificationRecordRow>(
    `SELECT DISTINCT ON (level)
            level, status, scope, method, source, checked_at, expires_at,
            checked_by_user_id, checked_by_system
       FROM verification_records
      WHERE business_id = $1
      ORDER BY level, checked_at DESC, created_at DESC`,
    [businessId],
  );

  const byLevel = new Map<VerificationLevel, VerificationRecordRow>();
  for (const row of rows) byLevel.set(row.level, row);

  return VERIFICATION_LEVELS.map((level) => {
    const definition = LEVEL_DEFINITION_BY_KEY[level];
    const record = byLevel.get(level);
    if (!record) {
      return {
        level,
        label: definition.label,
        meaning: definition.meaning,
        scope: definition.scope,
        requiresHumanReview: definition.requiresHumanReview,
        status: 'not_started' as const,
        held: false,
        method: null,
        source: null,
        checkedAt: null,
        expiresAt: null,
        checkedBy: null,
      };
    }

    const held = isCurrentlyHeld({ status: record.status, expiresAt: record.expires_at });
    return {
      level,
      label: definition.label,
      meaning: definition.meaning,
      // The recorded scope describes what was actually checked; the definition's
      // scope is the general boundary of the level, used when no record exists.
      requiresHumanReview: definition.requiresHumanReview,
      status: record.status,
      held,
      scope: record.scope ?? definition.scope,
      method: record.method,
      source: record.source,
      checkedAt: record.checked_at.toISOString(),
      expiresAt: record.expires_at?.toISOString() ?? null,
      checkedBy: record.checked_by_user_id
        ? `AllCompanies reviewer`
        : (record.checked_by_system ?? null),
    };
  });
}

/** Records a verification outcome. The only writer of verification_records. */
export async function recordVerification(
  client: PoolClient,
  input: {
    businessId: string;
    level: VerificationLevel;
    status: VerificationStatus;
    scope?: string | null;
    method?: string | null;
    source?: string | null;
    expiresAt?: Date | null;
    checkedByUserId?: string | null;
    checkedBySystem?: string | null;
  },
): Promise<void> {
  if (!input.checkedByUserId && !input.checkedBySystem) {
    throw new Error('Verification records must name a reviewer or a system.');
  }
  await client.query(
    `INSERT INTO verification_records
       (business_id, level, status, scope, method, source, expires_at,
        checked_by_user_id, checked_by_system)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.businessId,
      input.level,
      input.status,
      input.scope ?? null,
      input.method ?? null,
      input.source ?? null,
      input.expiresAt ?? null,
      input.checkedByUserId ?? null,
      input.checkedBySystem ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Bounded retry for the (astronomically unlikely) UBP id or slug collision. */
const MAX_CREATE_ATTEMPTS = 6;

export async function createBusiness(input: {
  ownerUserId: string;
  data: CreateBusinessInput;
  ownerEmailVerified: boolean;
}): Promise<BusinessDetail> {
  const slug = normaliseSlug(input.data.slug);
  const slugCheck = checkSlug(slug);
  if (!slugCheck.ok) {
    throw validationFailed({ slug: slugCheck.reason ?? 'That web address is not available.' });
  }

  const slugTaken = await queryOne<{ id: string }>('SELECT id FROM businesses WHERE slug = $1', [slug]);
  if (slugTaken) {
    throw conflict('That web address is already in use. Please choose another.', {
      slug: 'That web address is already in use. Please choose another.',
    });
  }

  const created = await withTransaction(async (client) => {
    let row: BusinessRow | null = null;

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      const ubpId = generateUbpId();
      try {
        const result = await client.query<BusinessRow>(
          `INSERT INTO businesses (
             owner_user_id, ubp_id, slug, display_name, tagline, description, category,
             country_code, region, city, website_url, contact_email, contact_phone,
             languages, show_email_publicly, show_phone_publicly, status
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12, $13,
             $14, $15, $16, 'draft'
           )
           RETURNING *`,
          [
            input.ownerUserId,
            ubpId,
            slug,
            input.data.displayName,
            input.data.tagline ?? null,
            input.data.description ?? null,
            input.data.category ?? null,
            input.data.countryCode ?? null,
            input.data.region ?? null,
            input.data.city ?? null,
            input.data.websiteUrl ?? null,
            input.data.contactEmail ?? null,
            input.data.contactPhone ?? null,
            input.data.languages ?? [],
            input.data.showEmailPublicly ?? false,
            input.data.showPhonePublicly ?? false,
          ],
        );
        row = result.rows[0] ?? null;
        break;
      } catch (error) {
        const code = (error as { code?: string }).code;
        const constraint = (error as { constraint?: string }).constraint;
        if (code === '23505' && constraint === 'businesses_ubp_id_key') continue;
        if (code === '23505' && constraint === 'businesses_slug_key') {
          throw conflict('That web address is already in use. Please choose another.', {
            slug: 'That web address is already in use. Please choose another.',
          });
        }
        throw error;
      }
    }

    if (!row) throw new Error('Could not allocate a unique UBP identifier. Please try again.');

    // `profile_created` is the only level Phase 1 grants on the basis of the
    // profile merely existing. It is attributed to the platform, not to a
    // human reviewer, and it asserts nothing beyond ownership of a profile.
    await recordVerification(client, {
      businessId: row.id,
      level: 'profile_created',
      status: 'verified',
      method: 'Automatic: profile row created',
      source: 'AllCompanies platform',
      checkedBySystem: 'profile_creation',
      scope: 'Confirms a profile exists and is owned by a registered account. It does not confirm any statement in the profile is accurate.',
    });

    if (input.ownerEmailVerified) {
      await recordVerification(client, {
        businessId: row.id,
        level: 'email_verified',
        status: 'verified',
        method: 'Automatic: account email confirmed via single-use link',
        source: 'AllCompanies platform',
        checkedBySystem: 'account_email_verification',
        scope: 'Confirms the account holder can receive email at their registered address.',
      });
    }

    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1::uuid, 'business.created', 'business', $2::text, $3::jsonb)`,
      [input.ownerUserId, row.id, JSON.stringify({ slug, ubpId: row.ubp_id })],
    );

    return row;
  });

  const verification = await loadVerification(created.id);
  return toBusinessDetail(created, verification);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getBusinessById(id: string): Promise<BusinessRow | null> {
  // A malformed UUID would reach Postgres as a cast error, so it is rejected
  // here and treated as "not found" rather than surfacing as a 500.
  if (!isUuid(id)) return null;
  return queryOne<BusinessRow>('SELECT * FROM businesses WHERE id = $1', [id]);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function getBusinessBySlug(slug: string): Promise<BusinessRow | null> {
  return queryOne<BusinessRow>('SELECT * FROM businesses WHERE slug = $1', [slug]);
}

export async function getBusinessByUbpId(ubpId: string): Promise<BusinessRow | null> {
  return queryOne<BusinessRow>('SELECT * FROM businesses WHERE ubp_id = $1', [ubpId]);
}

export async function listBusinessesForOwner(ownerUserId: string): Promise<BusinessDetail[]> {
  const rows = await query<BusinessRow>(
    'SELECT * FROM businesses WHERE owner_user_id = $1 ORDER BY created_at DESC',
    [ownerUserId],
  );
  const details: BusinessDetail[] = [];
  for (const row of rows) {
    details.push(toBusinessDetail(row, await loadVerification(row.id)));
  }
  return details;
}

export interface DirectoryQuery {
  search?: string | undefined;
  country?: string | undefined;
  category?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface DirectoryResult {
  items: PublicBusiness[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const MAX_PAGE_SIZE = 50;

/**
 * Public directory. Only published businesses are ever returned, so drafts and
 * suspended profiles cannot leak through search.
 */
export async function searchPublishedBusinesses(input: DirectoryQuery): Promise<DirectoryResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? 12)));

  const conditions: string[] = [`status = 'published'`];
  const params: unknown[] = [];

  if (input.search && input.search.trim().length > 0) {
    params.push(`%${input.search.trim()}%`);
    const index = params.length;
    conditions.push(
      `(display_name ILIKE $${index} OR COALESCE(tagline, '') ILIKE $${index} OR COALESCE(description, '') ILIKE $${index} OR COALESCE(category, '') ILIKE $${index})`,
    );
  }
  if (input.country && /^[A-Za-z]{2}$/.test(input.country)) {
    params.push(input.country.toUpperCase());
    conditions.push(`country_code = $${params.length}`);
  }
  if (input.category && input.category.trim().length > 0) {
    params.push(input.category.trim());
    conditions.push(`category = $${params.length}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM businesses ${where}`,
    params,
  );
  const total = Number(countRow?.count ?? '0');

  const rows = await query<BusinessRow>(
    `SELECT * FROM businesses ${where}
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  const items: PublicBusiness[] = [];
  for (const row of rows) {
    items.push(toPublicBusiness(row, await loadVerification(row.id)));
  }

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Distinct categories present in the published directory, for filter menus. */
export async function listPublishedCategories(): Promise<string[]> {
  const rows = await query<{ category: string }>(
    `SELECT DISTINCT category FROM businesses
      WHERE status = 'published' AND category IS NOT NULL
      ORDER BY category`,
  );
  return rows.map((row) => row.category);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Enforces every rule for a business becoming publicly visible.
 *
 * Called from both the dedicated publish endpoint and `updateBusiness`, so a
 * direct `PATCH {"status":"published"}` cannot skip a check that the publish
 * endpoint applies. Before this existed, the "no empty shell in the directory"
 * rule and the suspension rule were enforced on only one of the two paths.
 */
export function assertCanPublish(row: BusinessRow): void {
  if (row.status === 'suspended') {
    throw forbidden('This business has been suspended and cannot be published.');
  }
  if (!row.description && !row.tagline) {
    throw badRequest(
      'Add a tagline or description before publishing, so visitors see what the business does.',
    );
  }
}

/**
 * Loads a business and asserts that `actorUserId` owns it.
 *
 * This is the single choke point for business authorisation. Every mutating
 * path calls it, so an authorisation check cannot be forgotten on a new route.
 */
export async function requireOwnedBusiness(
  businessId: string,
  actorUserId: string,
): Promise<BusinessRow> {
  const row = await getBusinessById(businessId);
  if (!row) throw notFound('That business could not be found.');
  if (row.owner_user_id !== actorUserId) {
    // Deliberately the same 403 regardless of whether the row exists, so the
    // endpoint cannot be used to enumerate other businesses.
    throw forbidden('You do not have permission to change this business.');
  }
  return row;
}

export async function updateBusiness(input: {
  businessId: string;
  actorUserId: string;
  data: UpdateBusinessInput;
}): Promise<BusinessDetail> {
  const existing = await requireOwnedBusiness(input.businessId, input.actorUserId);

  const assignments: string[] = [];
  const params: unknown[] = [existing.id];

  const push = (column: string, value: unknown) => {
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  };

  const data = input.data;

  if (data.slug !== undefined) {
    const slug = normaliseSlug(data.slug);
    const slugCheck = checkSlug(slug);
    if (!slugCheck.ok) {
      throw validationFailed({ slug: slugCheck.reason ?? 'That web address is not available.' });
    }
    if (slug !== existing.slug) {
      const taken = await queryOne<{ id: string }>(
        'SELECT id FROM businesses WHERE slug = $1 AND id <> $2',
        [slug, existing.id],
      );
      if (taken) {
        throw conflict('That web address is already in use. Please choose another.', {
          slug: 'That web address is already in use. Please choose another.',
        });
      }
      push('slug', slug);
    }
  }

  const simpleColumns: Array<[keyof UpdateBusinessInput, string]> = [
    ['displayName', 'display_name'],
    ['tagline', 'tagline'],
    ['description', 'description'],
    ['category', 'category'],
    ['countryCode', 'country_code'],
    ['region', 'region'],
    ['city', 'city'],
    ['websiteUrl', 'website_url'],
    ['contactEmail', 'contact_email'],
    ['contactPhone', 'contact_phone'],
    ['languages', 'languages'],
    ['showEmailPublicly', 'show_email_publicly'],
    ['showPhonePublicly', 'show_phone_publicly'],
  ];

  for (const [field, column] of simpleColumns) {
    if (data[field] !== undefined) push(column, data[field]);
  }

  if (data.status !== undefined) {
    if (existing.status === 'suspended') {
      throw forbidden('This business has been suspended and cannot be republished from here.');
    }
    if (data.status === 'published') {
      // Rules are evaluated against the values this same request would leave in
      // place, so supplying a tagline and publishing in one PATCH still works,
      // while publishing an empty profile through PATCH is refused exactly as
      // the dedicated publish endpoint refuses it.
      assertCanPublish({
        ...existing,
        tagline: data.tagline !== undefined ? data.tagline : existing.tagline,
        description: data.description !== undefined ? data.description : existing.description,
      });
    }
    push('status', data.status);
    if (data.status === 'published') {
      assignments.push(`published_at = COALESCE(published_at, now())`);
    }
  }

  if (assignments.length === 0) {
    throw validationFailed({ _form: 'No changes were provided.' });
  }

  const updated = await withTransaction(async (client) => {
    const result = await client.query<BusinessRow>(
      `UPDATE businesses SET ${assignments.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    const row = result.rows[0];
    if (!row) throw notFound('That business could not be found.');

    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1::uuid, 'business.updated', 'business', $2::text, $3::jsonb)`,
      [
        input.actorUserId,
        row.id,
        JSON.stringify({ fields: Object.keys(data).filter((key) => data[key as keyof UpdateBusinessInput] !== undefined) }),
      ],
    );
    return row;
  });

  return toBusinessDetail(updated, await loadVerification(updated.id));
}

/**
 * Suggests an unused slug for a business name.
 * Purely advisory: the create path re-checks the chosen slug under a unique index.
 */
export async function suggestAvailableSlug(displayName: string): Promise<string> {
  const base = suggestSlug(displayName) || 'my-business';
  const safeBase = base.length >= 3 ? base : `${base}-co`;

  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? safeBase : `${safeBase.slice(0, 56)}-${suffix}`;
    if (!checkSlug(candidate).ok) continue;
    const taken = await queryOne<{ id: string }>('SELECT id FROM businesses WHERE slug = $1', [
      candidate,
    ]);
    if (!taken) return candidate;
  }
  return `${safeBase.slice(0, 48)}-${Date.now().toString(36)}`;
}

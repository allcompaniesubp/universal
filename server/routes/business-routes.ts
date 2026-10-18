/**
 * Business profile routes.
 *
 * Authorisation summary:
 *   - Reads of a published business, and of any business by its public UBP id,
 *     are unauthenticated and return only the public projection.
 *   - Reads of a business that is not published require the owner.
 *   - Every write calls `requireOwnedBusiness`, which compares the session user
 *     with `businesses.owner_user_id`. No route trusts a client-supplied owner.
 */

import { getConfig } from '../config.ts';
import { badRequest, forbidden, notFound } from '../http/errors.ts';
import { enforceRateLimit, optionalUser, parseBody, requireUser } from '../http/auth-context.ts';
import type { ApiRequest, ApiResponse, Router } from '../http/router.ts';
import { RATE_LIMITS } from '../http/rate-limit.ts';
import {
  createBusiness,
  getBusinessById,
  getBusinessBySlug,
  getBusinessByUbpId,
  listBusinessesForOwner,
  listPublishedCategories,
  loadVerification,
  requireOwnedBusiness,
  searchPublishedBusinesses,
  suggestAvailableSlug,
  toBusinessDetail,
  toPublicBusiness,
  updateBusiness,
} from '../services/business-service.ts';
import { buildVCard, vCardFilename } from '../services/card-service.ts';
import {
  buildBusinessUrl,
  buildVerificationUrl,
  renderQrSvg,
  resolvePublicOrigin,
} from '../services/qr-service.ts';
import { createBusinessSchema, updateBusinessSchema } from '../validation/schemas.ts';

/** Statuses whose full business profile a non-owner may read. */
const PUBLICLY_READABLE = new Set(['published']);

/**
 * Statuses whose *verification status* still resolves for anyone holding the
 * identifier. A suspended passport is included deliberately: a card printed
 * before suspension must not scan as "no such passport", because that would be
 * indistinguishable from a forged card. The verification page instead reports
 * the passport as suspended and not currently valid.
 */
const VERIFICATION_RESOLVABLE = new Set(['published', 'suspended']);

function originFor(request: ApiRequest): string {
  return resolvePublicOrigin(getConfig(), request.origin);
}

/**
 * Loads a business for public consumption.
 * A non-published business is reported as 404 to everyone except its owner, so
 * drafts cannot be probed for existence.
 */
async function loadPubliclyReadable(
  request: ApiRequest,
  businessId: string,
  viewerUserId: string | null,
): Promise<ApiResponse> {
  const row = await getBusinessById(businessId);
  if (!row) throw notFound('That business could not be found.');

  const isOwner = viewerUserId !== null && row.owner_user_id === viewerUserId;
  if (!PUBLICLY_READABLE.has(row.status) && !isOwner) {
    throw notFound('That business could not be found.');
  }

  const verification = await loadVerification(row.id);
  const origin = originFor(request);

  const body = {
    business: isOwner
      ? toBusinessDetail(row, verification)
      : toPublicBusiness(row, verification),
    qrCodeUrl: `${origin}/api/businesses/${row.id}/qr.svg`,
    verificationUrl: buildVerificationUrl(origin, row.ubp_id),
    publicUrl: buildBusinessUrl(origin, row.slug),
    viewer: isOwner ? ('owner' as const) : ('public' as const),
  };

  return { status: 200, body };
}

export function registerBusinessRoutes(router: Router): void {
  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  router.post('/api/businesses', async (request) => {
    enforceRateLimit(request, 'write', RATE_LIMITS.write);
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    const input = parseBody(createBusinessSchema, request.body);

    const business = await createBusiness({
      ownerUserId: user.id,
      data: input,
      ownerEmailVerified: user.email_verified_at !== null,
    });

    return { status: 201, body: { business } };
  });

  // -------------------------------------------------------------------------
  // Owner: list own businesses
  // -------------------------------------------------------------------------

  router.get('/api/businesses', async (request) => {
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    const businesses = await listBusinessesForOwner(user.id);
    return { status: 200, body: { businesses } };
  });

  // -------------------------------------------------------------------------
  // Public: directory search
  // -------------------------------------------------------------------------

  router.get('/api/directory', async (request) => {
    enforceRateLimit(request, 'read', RATE_LIMITS.read);
    const result = await searchPublishedBusinesses({
      search: request.query.get('search') ?? undefined,
      country: request.query.get('country') ?? undefined,
      category: request.query.get('category') ?? undefined,
      page: Number(request.query.get('page') ?? '1'),
      pageSize: Number(request.query.get('pageSize') ?? '12'),
    });
    return { status: 200, body: result };
  });

  router.get('/api/directory/categories', async () => {
    const categories = await listPublishedCategories();
    return { status: 200, body: { categories } };
  });

  // -------------------------------------------------------------------------
  // Public: resolve a slug to a business
  // -------------------------------------------------------------------------

  router.get('/api/directory/by-slug/:slug', async (request) => {
    enforceRateLimit(request, 'read', RATE_LIMITS.read);
    const slug = request.params.slug ?? '';
    const row = await getBusinessBySlug(slug);
    if (!row) throw notFound('No business was found at that web address.');

    const config = getConfig();
    const viewer = await optionalUser(request, config.sessionCookieName);
    const isOwner = viewer !== null && viewer.id === row.owner_user_id;

    if (!PUBLICLY_READABLE.has(row.status) && !isOwner) {
      throw notFound('No business was found at that web address.');
    }

    const verification = await loadVerification(row.id);
    const origin = originFor(request);
    return {
      status: 200,
      body: {
        business: isOwner ? toBusinessDetail(row, verification) : toPublicBusiness(row, verification),
        publicUrl: buildBusinessUrl(origin, row.slug),
        verificationUrl: buildVerificationUrl(origin, row.ubp_id),
        viewer: isOwner ? 'owner' : 'public',
      },
    };
  });

  // -------------------------------------------------------------------------
  // Public: verification by UBP id
  // -------------------------------------------------------------------------

  router.get('/api/verify/:ubpId', async (request) => {
    enforceRateLimit(request, 'read', RATE_LIMITS.read);
    const ubpId = (request.params.ubpId ?? '').toUpperCase();
    if (!/^UBP-[0-9A-Z]{8}$/.test(ubpId)) {
      throw badRequest('A valid UBP identifier is required, for example UBP-4K7M2XQ9.');
    }

    const row = await getBusinessByUbpId(ubpId);
    // A well-formed identifier that was never issued is reported as not found, so
    // the verification page can say plainly that no such passport exists. A
    // suspended passport still resolves, and is reported as suspended below.
    if (!row || !VERIFICATION_RESOLVABLE.has(row.status)) {
      throw notFound('No Universal Business Passport was found with that identifier.');
    }

    const verification = await loadVerification(row.id);
    const origin = originFor(request);
    const suspended = row.status === 'suspended';

    return {
      status: 200,
      body: {
        ubpId: row.ubp_id,
        displayName: row.display_name,
        slug: row.slug,
        status: row.status,
        // A suspended passport is still resolvable, but is reported as not
        // currently valid rather than hidden.
        currentlyValid: PUBLICLY_READABLE.has(row.status),
        suspended,
        publicUrl: buildBusinessUrl(origin, row.slug),
        verificationUrl: buildVerificationUrl(origin, row.ubp_id),
        issuedAt: row.created_at.toISOString(),
        verification,
      },
    };
  });

  // -------------------------------------------------------------------------
  // Owner: read, update, publish, unpublish
  // -------------------------------------------------------------------------

  router.get('/api/businesses/:id', async (request) => {
    const config = getConfig();
    const viewer = await optionalUser(request, config.sessionCookieName);
    return loadPubliclyReadable(request, request.params.id ?? '', viewer?.id ?? null);
  });

  router.patch('/api/businesses/:id', async (request) => {
    enforceRateLimit(request, 'write', RATE_LIMITS.write);
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    const input = parseBody(updateBusinessSchema, request.body);

    const business = await updateBusiness({
      businessId: request.params.id ?? '',
      actorUserId: user.id,
      data: input,
    });

    return { status: 200, body: { business } };
  });

  // -------------------------------------------------------------------------
  // Owner: QR code, verification URL, vCard
  // -------------------------------------------------------------------------

  router.get('/api/businesses/:id/qr.svg', async (request) => {
    const row = await getBusinessById(request.params.id ?? '');
    if (!row) throw notFound('That business could not be found.');

    const config = getConfig();
    const viewer = await optionalUser(request, config.sessionCookieName);
    const isOwner = viewer !== null && viewer.id === row.owner_user_id;
    if (!PUBLICLY_READABLE.has(row.status) && !isOwner) {
      throw notFound('That business could not be found.');
    }

    // The QR payload is the public verification URL for the UBP identifier.
    // It contains no private field and no token.
    const payload = buildVerificationUrl(originFor(request), row.ubp_id);
    const svg = await renderQrSvg(payload, { size: 320 });

    return {
      status: 200,
      body: svg,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    };
  });

  /**
   * vCard download. Gated to the owner: a public visitor cannot bulk-harvest
   * contact details through this endpoint.
   */
  router.get('/api/businesses/:id/card.vcf', async (request) => {
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    const row = await requireOwnedBusiness(request.params.id ?? '', user.id);

    const origin = originFor(request);
    const websiteUrl = row.website_url ?? buildBusinessUrl(origin, row.slug);
    const vcard = buildVCard({ business: row, websiteUrl });

    return {
      status: 200,
      body: vcard,
      headers: {
        'Content-Type': 'text/vcard; charset=utf-8',
        'Content-Disposition': `attachment; filename="${vCardFilename(row)}"`,
        'Cache-Control': 'no-store',
      },
    };
  });

  // -------------------------------------------------------------------------
  // Public: QR code addressed by UBP identifier
  // -------------------------------------------------------------------------

  /**
   * Same payload as the UUID-keyed QR route, addressed by the public UBP
   * identifier so a public page never needs to know a business's internal UUID.
   * Only published or suspended passports resolve here; a draft is not readable.
   */
  router.get('/api/verify-qr/:ubpId', async (request) => {
    enforceRateLimit(request, 'read', RATE_LIMITS.read);
    // The path may carry a .svg suffix for caching and download convenience.
    const raw = (request.params.ubpId ?? '').replace(/\.svg$/i, '').toUpperCase();
    if (!/^UBP-[0-9A-Z]{8}$/.test(raw)) {
      throw badRequest('A valid UBP identifier is required.');
    }

    const row = await getBusinessByUbpId(raw);
    if (!row || !VERIFICATION_RESOLVABLE.has(row.status)) {
      throw notFound('No published passport was found with that identifier.');
    }

    const payload = buildVerificationUrl(originFor(request), row.ubp_id);
    const svg = await renderQrSvg(payload, { size: 320 });

    return {
      status: 200,
      body: svg,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    };
  });

  // -------------------------------------------------------------------------
  // Owner: slug suggestion helper
  // -------------------------------------------------------------------------

  router.get('/api/businesses/slug-suggestion', async (request) => {
    const name = request.query.get('displayName') ?? '';
    if (name.trim().length < 2) throw badRequest('Provide a business name of at least 2 characters.');
    const slug = await suggestAvailableSlug(name);
    return { status: 200, body: { slug } };
  });

  // -------------------------------------------------------------------------
  // Owner: publication state
  // -------------------------------------------------------------------------

  router.post('/api/businesses/:id/publish', async (request) => {
    enforceRateLimit(request, 'write', RATE_LIMITS.write);
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    const row = await requireOwnedBusiness(request.params.id ?? '', user.id);

    if (row.status === 'suspended') {
      throw forbidden('This business has been suspended and cannot be published.');
    }
    // A minimum of information is required before a page becomes public, so the
    // directory never lists an empty shell.
    if (!row.description && !row.tagline) {
      throw badRequest(
        'Add a tagline or description before publishing, so visitors see what the business does.',
      );
    }

    const business = await updateBusiness({
      businessId: row.id,
      actorUserId: user.id,
      data: { status: 'published' },
    });
    return { status: 200, body: { business } };
  });

  router.post('/api/businesses/:id/unpublish', async (request) => {
    enforceRateLimit(request, 'write', RATE_LIMITS.write);
    const config = getConfig();
    const user = await requireUser(request, config.sessionCookieName);
    await requireOwnedBusiness(request.params.id ?? '', user.id);

    const business = await updateBusiness({
      businessId: request.params.id ?? '',
      actorUserId: user.id,
      data: { status: 'unpublished' },
    });
    return { status: 200, body: { business } };
  });
}

/**
 * API client.
 *
 * Every call goes through `request`, which:
 *   - sends cookies (credentials: 'include') so the session works,
 *   - never places a credential in a query string or localStorage,
 *   - turns a non-2xx response into a typed ApiError carrying field errors,
 *     so forms can show server-side validation messages rather than a generic
 *     failure.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

function extractFields(details: unknown): Record<string, string> {
  if (!details || typeof details !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload: unknown = isJson ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    const body = (payload ?? {}) as ErrorBody;
    throw new ApiError(
      response.status,
      body.error?.code ?? 'error',
      body.error?.message ?? 'The request could not be completed.',
      extractFields(body.error?.details),
    );
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// Types shared with the server
// ---------------------------------------------------------------------------

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: 'member' | 'moderator' | 'admin';
  emailVerified: boolean;
  createdAt: string;
}

export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'expired' | 'revoked' | 'not_started';

export interface VerificationEntry {
  level: string;
  label: string;
  meaning: string;
  status: VerificationStatus;
  held: boolean;
  scope: string | null;
  method: string | null;
  source: string | null;
  checkedAt: string | null;
  expiresAt: string | null;
  checkedBy: string | null;
}

export type BusinessStatus = 'draft' | 'published' | 'unpublished' | 'suspended';

export interface Business {
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

export interface BusinessDetailResponse {
  business: Business | PublicBusiness;
  qrCodeUrl: string;
  verificationUrl: string;
  publicUrl: string;
  viewer: 'owner' | 'public';
}

export interface VerificationResponse {
  ubpId: string;
  displayName: string;
  slug: string;
  status: BusinessStatus;
  currentlyValid: boolean;
  suspended: boolean;
  publicUrl: string;
  verificationUrl: string;
  issuedAt: string;
  verification: VerificationEntry[];
}

export interface DirectoryResponse {
  items: PublicBusiness[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RegisterResponse {
  user: PublicUser;
  emailVerification:
    | { delivered: true; transport: string }
    | {
        delivered: false;
        reason: string;
        message: string;
        verificationUrl: string;
      };
}

export interface ConfigStatus {
  emailDeliveryConfigured: boolean;
  paymentsEnabled: boolean;
  aiToolsEnabled: boolean;
  listingsEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
  register: (input: { email: string; password: string; fullName: string }) =>
    request<RegisterResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  login: (input: { email: string; password: string }) =>
    request<{ user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  session: () => request<{ user: PublicUser | null }>('/api/auth/session'),

  verifyEmail: (token: string) =>
    request<{ outcome: string; message: string }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<{ ok: true; message: string }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  configStatus: () => request<ConfigStatus>('/api/config/status'),

  listMyBusinesses: () => request<{ businesses: Business[] }>('/api/businesses'),

  createBusiness: (input: Record<string, unknown>) =>
    request<{ business: Business }>('/api/businesses', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getBusiness: (id: string) => request<BusinessDetailResponse>(`/api/businesses/${encodeURIComponent(id)}`),

  updateBusiness: (id: string, input: Record<string, unknown>) =>
    request<{ business: Business }>(`/api/businesses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  publishBusiness: (id: string) =>
    request<{ business: Business }>(`/api/businesses/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
    }),

  unpublishBusiness: (id: string) =>
    request<{ business: Business }>(`/api/businesses/${encodeURIComponent(id)}/unpublish`, {
      method: 'POST',
    }),

  slugSuggestion: (displayName: string) =>
    request<{ slug: string }>(
      `/api/businesses/slug-suggestion?displayName=${encodeURIComponent(displayName)}`,
    ),

  directory: (params: { search?: string; country?: string; category?: string; page?: number }) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.country) query.set('country', params.country);
    if (params.category) query.set('category', params.category);
    if (params.page) query.set('page', String(params.page));
    const suffix = query.toString();
    return request<DirectoryResponse>(`/api/directory${suffix ? `?${suffix}` : ''}`);
  },

  directoryCategories: () => request<{ categories: string[] }>('/api/directory/categories'),

  businessBySlug: (slug: string) =>
    request<{
      business: Business | PublicBusiness;
      publicUrl: string;
      verificationUrl: string;
      viewer: 'owner' | 'public';
    }>(`/api/directory/by-slug/${encodeURIComponent(slug)}`),

  verify: (ubpId: string) =>
    request<VerificationResponse>(`/api/verify/${encodeURIComponent(ubpId)}`),
};

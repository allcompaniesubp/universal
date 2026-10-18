/**
 * Small formatting helpers.
 */

/** Renders a country code as a flag emoji plus the code, falling back to the code. */
export function countryLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return upper;
  const flag = String.fromCodePoint(...[...upper].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
  return `${flag} ${upper}`;
}

export function locationLabel(parts: {
  city?: string | null;
  region?: string | null;
  countryCode?: string | null;
}): string | null {
  const pieces = [parts.city, parts.region, countryLabel(parts.countryCode)].filter(
    (piece): piece is string => Boolean(piece),
  );
  return pieces.length > 0 ? pieces.join(', ') : null;
}

/** Formats an ISO timestamp as a readable date, or returns null when absent. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Maps a business status to the label and tone used in the UI. */
export function statusMeta(status: string): { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' } {
  switch (status) {
    case 'published':
      return { label: 'Published', tone: 'good' };
    case 'draft':
      return { label: 'Draft', tone: 'neutral' };
    case 'unpublished':
      return { label: 'Unpublished', tone: 'warn' };
    case 'suspended':
      return { label: 'Suspended', tone: 'bad' };
    default:
      return { label: status, tone: 'neutral' };
  }
}

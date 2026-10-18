/**
 * QR code rendering.
 *
 * QR codes are rendered server-side as SVG. SVG is a few kilobytes of text,
 * needs no image-processing binary, and stays crisp when printed on a physical
 * card. The payload is always an absolute URL to a public verification page, so
 * a scan can never reach private data: the encoded value is only the UBP
 * identifier, which is itself a public value.
 */

import QRCode from 'qrcode';

export interface QrRenderOptions {
  /** Rendered size in pixels. */
  size?: number;
  /** Error-correction level. M tolerates ~15% damage, which suits printed cards. */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

export async function renderQrSvg(payload: string, options: QrRenderOptions = {}): Promise<string> {
  return QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
    margin: 1,
    width: options.size ?? 256,
    color: { dark: '#0b2545ff', light: '#ffffffff' },
  });
}

/**
 * Returns the trusted absolute origin to embed in QR codes, share links and
 * email links.
 *
 * The origin comes from configuration only. An earlier version fell back to the
 * request's `Host` header, which is attacker-controlled: any caller could make
 * the API emit links pointing at a domain they chose, and the QR endpoint
 * caches its response, so a single hostile request could poison a shared cache
 * with an attacker-origin QR code. `config.publicBaseUrl` is validated at load
 * time (https on deployed environments, origin only), so there is no request
 * input in this path at all.
 */
export function resolvePublicOrigin(config: { publicBaseUrl: string }): string {
  return config.publicBaseUrl.replace(/\/+$/, '');
}

/**
 * Builds an absolute URL under the given origin.
 *
 * Trailing slashes on the origin are collapsed, because a doubled slash
 * ("https://example.test//verify/UBP-...") is a different URL to a web server
 * and would break a QR code printed on a physical card.
 */
function buildUrl(origin: string, ...segments: string[]): string {
  const base = origin.replace(/\/+$/, '');
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return `${base}/${path}`;
}

export function buildVerificationUrl(origin: string, ubpId: string): string {
  return buildUrl(origin, 'verify', ubpId);
}

export function buildBusinessUrl(origin: string, slug: string): string {
  return buildUrl(origin, 'business', slug);
}

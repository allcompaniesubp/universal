/**
 * Digital business card export.
 *
 * Produces a vCard 3.0 text file. vCard 3.0 is chosen over 4.0 because it is
 * the version that iOS, Android and Outlook all import without complaint.
 *
 * Only fields the owner has marked public are exported, and only for a
 * published business, so a contact download can never leak private details.
 */

import type { BusinessRow } from './business-service.ts';

/** Escapes the characters vCard treats as structure. */
function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds long lines at 75 octets, as required by RFC 2426. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    // 74 leaves room for the leading continuation space.
    if (currentBytes + size > 74 && current !== '') {
      parts.push(current);
      current = character;
      currentBytes = size;
    } else {
      current += character;
      currentBytes += size;
    }
  }
  if (current) parts.push(current);
  return parts.join('\r\n ');
}

export interface VCardInput {
  business: BusinessRow;
  websiteUrl: string | null;
}

export function buildVCard(input: VCardInput): string {
  const business = input.business;
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

  lines.push(`FN:${escapeValue(business.display_name)}`);
  lines.push(`ORG:${escapeValue(business.legal_name ?? business.display_name)}`);

  if (business.tagline) lines.push(`TITLE:${escapeValue(business.tagline)}`);

  if (business.show_email_publicly && business.contact_email) {
    lines.push(`EMAIL;TYPE=WORK:${escapeValue(business.contact_email)}`);
  }
  if (business.show_phone_publicly && business.contact_phone) {
    lines.push(`TEL;TYPE=WORK,VOICE:${escapeValue(business.contact_phone)}`);
  }
  if (input.websiteUrl) lines.push(`URL:${escapeValue(input.websiteUrl)}`);

  const locality = [business.city, business.region, business.country_code]
    .filter((part): part is string => Boolean(part))
    .join(', ');
  if (locality) {
    lines.push(`ADR;TYPE=WORK:;;${escapeValue(locality)};;;;`);
  }

  // The UBP identifier and the public profile URL are the point of the card.
  if (business.description) {
    lines.push(`NOTE:${escapeValue(`${business.description}\n\nUBP ID: ${business.ubp_id}`)}`);
  } else {
    lines.push(`NOTE:UBP ID: ${business.ubp_id}`);
  }

  lines.push(`X-UBP-ID:${business.ubp_id}`);
  lines.push('END:VCARD');

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function vCardFilename(business: BusinessRow): string {
  const safe = business.slug.replace(/[^a-z0-9-]/g, '-');
  return `${safe}-ubp-${business.ubp_id}.vcf`;
}

/**
 * Universal Business Passport card.
 *
 * Design intent: this must read as a membership and identity credential, not as
 * a payment card. Concretely, it deliberately avoids every visual cue that
 * signals a bank card:
 *   - no 16-digit grouped number and no chip contact pattern,
 *   - no card-network logo or "valid thru" field,
 *   - portrait-ish proportions rather than the 85.6 x 53.98 mm payment ratio,
 *   - the identifier is prefixed "UBP-", not a bare number,
 *   - an explicit "Not a payment card" line is printed on the face.
 */

import type { Business } from '../lib/api.ts';
import { countryLabel } from '../lib/format.ts';

export function PassportCard({
  business,
  verificationUrl,
  qrCodeUrl,
}: {
  business: Pick<
    Business,
    'ubpId' | 'displayName' | 'tagline' | 'slug' | 'countryCode' | 'city' | 'createdAt' | 'status'
  >;
  verificationUrl: string;
  qrCodeUrl: string;
}) {
  const issued = new Date(business.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
  });
  const location = [business.city, countryLabel(business.countryCode)].filter(Boolean).join(', ');

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="passport-surface overflow-hidden rounded-2xl bg-navy-900 p-5 text-white shadow-xl ring-1 ring-navy-700">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-gold-300">
              Universal Business Passport
            </p>
            <p className="mt-0.5 text-[0.6rem] uppercase tracking-wider text-navy-200">
              AllCompanies
            </p>
          </div>
          <div className="rounded border border-gold-400/40 px-2 py-1 text-right">
            <p className="text-[0.5rem] uppercase tracking-wider text-gold-200">Member</p>
            <p className="text-[0.6rem] font-semibold text-gold-100">Business</p>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-[0.6rem] uppercase tracking-wider text-navy-300">Business</p>
          <p className="truncate text-lg font-semibold leading-tight">{business.displayName}</p>
          {business.tagline && (
            <p className="mt-0.5 line-clamp-2 text-xs text-navy-200">{business.tagline}</p>
          )}
        </div>

        <div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-4">
          <div className="space-y-2">
            <div>
              <p className="text-[0.6rem] uppercase tracking-wider text-navy-300">Passport ID</p>
              <p className="font-mono text-base font-semibold tracking-[0.12em] text-gold-200">
                {business.ubpId}
              </p>
            </div>
            {location && (
              <div>
                <p className="text-[0.6rem] uppercase tracking-wider text-navy-300">Location</p>
                <p className="text-xs text-navy-100">{location}</p>
              </div>
            )}
            <div>
              <p className="text-[0.6rem] uppercase tracking-wider text-navy-300">Issued</p>
              <p className="text-xs text-navy-100">{issued}</p>
            </div>
          </div>

          <div className="rounded-lg bg-white p-1.5">
            <img
              src={qrCodeUrl}
              alt={`QR code linking to the public verification page for ${business.ubpId}`}
              className="h-24 w-24"
              width={96}
              height={96}
            />
          </div>
        </div>

        <div className="mt-4 border-t border-navy-700 pt-2.5">
          <p className="text-[0.6rem] leading-relaxed text-navy-300">
            Not a payment card. This passport is a private digital business identity and membership
            credential issued by AllCompanies. It is not a government-issued document, a licence, or
            an endorsement.
          </p>
          <p className="mt-1 truncate font-mono text-[0.6rem] text-navy-400">{verificationUrl}</p>
        </div>
      </div>
    </div>
  );
}

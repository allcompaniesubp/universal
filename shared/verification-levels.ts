/**
 * Verification level definitions.
 *
 * This module is intentionally dependency-free and contains no Node built-ins,
 * because both the server and the browser bundle import it. It is the single
 * source of truth for what each verification level means, so the wording a
 * business sees in the dashboard is the same wording a visitor sees on the
 * public verification page.
 *
 * Design rule: a level is recorded as verified only after the corresponding
 * check has actually been carried out, and every record names who or what
 * performed it. Nothing here grants a level in exchange for a payment.
 */

export const VERIFICATION_LEVELS = [
  'profile_created',
  'email_verified',
  'contact_verified',
  'documents_reviewed',
  'registry_checked',
  'ubp_member',
] as const;

export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const VERIFICATION_STATUSES = [
  'pending',
  'verified',
  'rejected',
  'expired',
  'revoked',
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface LevelDefinition {
  key: VerificationLevel;
  /** Short public label. Deliberately modest: it describes the check, not the business. */
  label: string;
  /** What the level does and does not assert. */
  meaning: string;
  /** The exact boundary of the check, stated alongside the record. */
  scope: string;
  /** True when a human reviewer must perform the check. */
  requiresHumanReview: boolean;
  /** True for the two levels an automated system may record in Phase 1. */
  automaticInPhase1: boolean;
}

export const LEVEL_DEFINITIONS: readonly LevelDefinition[] = [
  {
    key: 'profile_created',
    label: 'Profile created',
    meaning:
      'The business supplied this profile information itself. It confirms that a profile exists and is owned by a registered account. It does not confirm that any statement in the profile is accurate.',
    scope:
      'Confirms a profile exists and is owned by a registered account. It does not confirm any statement in the profile is accurate.',
    requiresHumanReview: false,
    automaticInPhase1: true,
  },
  {
    key: 'email_verified',
    label: 'Email verified',
    meaning:
      'The account holder followed a single-use link sent to the business contact email address, confirming they can receive mail at that address. It does not confirm the address belongs to the business as a legal entity.',
    scope: 'Confirms the account holder can receive email at their registered address.',
    requiresHumanReview: false,
    automaticInPhase1: true,
  },
  {
    key: 'contact_verified',
    label: 'Contact verified',
    meaning:
      'A member of the AllCompanies team confirmed a specific contact method for this business. The contact method and the date of the check are recorded with the entry.',
    scope:
      'Confirms one named contact method reaches the business. Other contact methods are not checked.',
    requiresHumanReview: true,
    automaticInPhase1: false,
  },
  {
    key: 'documents_reviewed',
    label: 'Documents reviewed',
    meaning:
      'A member of the AllCompanies team reviewed documents the business provided. The scope of what was reviewed is stated with the record. This is not a legal opinion and not a statement of regulatory compliance.',
    scope:
      'Covers only the named documents and the date recorded. It is not a legal or compliance opinion.',
    requiresHumanReview: true,
    automaticInPhase1: false,
  },
  {
    key: 'registry_checked',
    label: 'Official registry checked',
    meaning:
      'A named official registry was consulted and the recorded result matched the details shown here. The registry name, the result and the date of the check are recorded with the entry.',
    scope:
      'Records one registry lookup on one date. It does not assert good standing at any later date, nor anything about registries not consulted.',
    requiresHumanReview: true,
    automaticInPhase1: false,
  },
  {
    key: 'ubp_member',
    label: 'UBP member',
    meaning:
      'The business holds an active Universal Business Passport membership. Membership is an identity and directory service provided by AllCompanies. It is not a licence, a certification, a government endorsement, or an indication of solvency or trustworthiness.',
    scope:
      'Confirms an active membership record. It is not a licence, certification or endorsement.',
    requiresHumanReview: true,
    automaticInPhase1: false,
  },
];

export const LEVEL_DEFINITION_BY_KEY: Readonly<Record<VerificationLevel, LevelDefinition>> =
  LEVEL_DEFINITIONS.reduce(
    (accumulator, definition) => {
      accumulator[definition.key] = definition;
      return accumulator;
    },
    {} as Record<VerificationLevel, LevelDefinition>,
  );

/** Levels that an automated system is permitted to mark verified. */
export const AUTOMATABLE_LEVELS: ReadonlySet<VerificationLevel> = new Set(
  LEVEL_DEFINITIONS.filter((definition) => definition.automaticInPhase1).map(
    (definition) => definition.key,
  ),
);

/** Human-readable label for a status. */
export function statusLabel(status: VerificationStatus): string {
  switch (status) {
    case 'pending':
      return 'In review';
    case 'verified':
      return 'Verified';
    case 'rejected':
      return 'Not verified';
    case 'expired':
      return 'Expired';
    case 'revoked':
      return 'Revoked';
  }
}

/**
 * A level counts as currently held only while it is `verified` and has not
 * passed its expiry. Everything else is displayed honestly as not held.
 */
export function isCurrentlyHeld(
  record: { status: VerificationStatus; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (record.status !== 'verified') return false;
  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export function canAutomateLevel(level: VerificationLevel): boolean {
  return AUTOMATABLE_LEVELS.has(level);
}

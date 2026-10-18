/**
 * Server-side re-export of the verification definitions.
 *
 * The definitions live in shared/verification-levels.ts so that the browser
 * bundle and the server use identical wording. This module exists so server code
 * imports from its own domain layer and the shared file stays free of Node
 * built-ins.
 */

export {
  VERIFICATION_LEVELS,
  VERIFICATION_STATUSES,
  AUTOMATABLE_LEVELS,
  LEVEL_DEFINITIONS,
  LEVEL_DEFINITION_BY_KEY,
  statusLabel,
  isCurrentlyHeld,
  canAutomateLevel,
} from '../../shared/verification-levels.ts';

export type {
  VerificationLevel,
  VerificationStatus,
  LevelDefinition,
} from '../../shared/verification-levels.ts';

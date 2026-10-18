/**
 * Email delivery.
 *
 * Phase 1 deliberately ships without a transactional email provider, because
 * every mainstream provider requires an account and, past a small free
 * allowance, a paid plan. Rather than silently pretending a message was sent,
 * the transport reports honestly:
 *
 *   EMAIL_TRANSPORT=none    -> nothing is sent. The API tells the caller that
 *                              delivery is not configured and returns the
 *                              verification link to the signed-in owner only,
 *                              so a single-operator deployment stays testable.
 *   EMAIL_TRANSPORT=console -> the link is written to the server log. Intended
 *                              for local development only.
 *
 * Adding a real provider later means implementing `sendVerificationEmail` for
 * that provider; no calling code changes.
 */

import { getConfig } from '../config.ts';

export type DeliveryOutcome =
  | { delivered: true; transport: 'console' }
  | { delivered: false; reason: 'not_configured' };

export interface VerificationEmail {
  to: string;
  fullName: string;
  verificationUrl: string;
}

export function emailDeliveryConfigured(): boolean {
  return getConfig().emailTransport !== 'none';
}

export async function sendVerificationEmail(message: VerificationEmail): Promise<DeliveryOutcome> {
  const config = getConfig();

  if (config.emailTransport === 'console') {
    // Development only: the link is printed rather than emailed.
    // eslint-disable-next-line no-console
    console.log(
      `[ubp] Email verification link for ${message.to} (${message.fullName}): ${message.verificationUrl}`,
    );
    return { delivered: true, transport: 'console' };
  }

  return { delivered: false, reason: 'not_configured' };
}

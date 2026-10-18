/**
 * Audit logging helpers.
 *
 * Administrative and security-relevant actions are recorded with the actor, the
 * entity, and a small metadata object. Client IPs are stored only as a hash.
 */

import { query } from '../db.ts';
import { hashIp } from '../crypto/tokens.ts';

export interface AuditInput {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  await query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata, ip_hash)
     VALUES ($1::uuid, $2, $3, $4::text, $5::jsonb, $6)`,
    [
      input.actorUserId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(input.metadata ?? {}),
      hashIp(input.ip),
    ],
  );
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Admin-only read. Returns recent entries, newest first. */
export async function listAuditEntries(limit = 100): Promise<AuditEntry[]> {
  const capped = Math.min(500, Math.max(1, Math.floor(limit)));
  const rows = await query<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id::text AS id, action, entity_type, entity_id, metadata, created_at
       FROM audit_log
      ORDER BY created_at DESC
      LIMIT $1`,
    [capped],
  );
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  }));
}

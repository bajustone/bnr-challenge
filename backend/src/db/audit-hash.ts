/**
 * Audit-log hash chain. Third defence behind grants + trigger.
 *   prev_hash = previous row_hash (or 32 zero bytes for the first)
 *   row_hash  = sha256(prev_hash || canonical_json(payload) [|| AUDIT_HASH_SECRET])
 * See docs/db-architecture.html §7.
 */

import { createHash } from 'node:crypto';

import { desc, sql } from 'drizzle-orm';

import { env } from '../env.ts';
import { auditLog } from './schema.ts';
import type { NewAuditLogRow } from './schema.ts';
import type { db } from './index.ts';

export const GENESIS_PREV_HASH = new Uint8Array(32);

/** Fields that participate in the hash. id/prev_hash/row_hash do not. */
type AuditEventInput = {
  occurredAt?: Date;
  actorId: string;
  actorRole: NewAuditLogRow['actorRole'];
  action: string;
  resourceType: string;
  resourceId: string;
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: Record<string, unknown>;
};

// Drizzle's transaction callback parameter type, pulled out via Parameters<>.
// Same trick repositories/types.ts uses; kept inline to avoid a db → repositories
// → db type cycle. Accept either the pool handle or a tx — the caller is
// expected to pass a tx (the FOR UPDATE on the chain tail is only meaningful
// inside one), but the looser type matches the repo wrapper's signature.
type DbHandle = typeof db;
type TxParam = Parameters<Parameters<DbHandle['transaction']>[0]>[0];
type Tx = DbHandle | TxParam;

/**
 * Canonical JSON: sorted keys, no whitespace. Writer and verifier MUST
 * produce identical bytes. Changing this function breaks the chain.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
      .join(',') +
    '}'
  );
}

function payloadBytes(ev: AuditEventInput, prevHash: Uint8Array, occurredAt: Date): Buffer {
  const payload = {
    occurred_at: occurredAt.toISOString(),
    actor_id: ev.actorId,
    actor_role: ev.actorRole,
    action: ev.action,
    resource_type: ev.resourceType,
    resource_id: ev.resourceId,
    before_state: ev.beforeState ?? null,
    after_state: ev.afterState ?? null,
    metadata: ev.metadata ?? {},
    prev_hash: Buffer.from(prevHash).toString('base64'),
  };
  return Buffer.from(canonicalJson(payload), 'utf8');
}

/** Exported so the verifier uses the same code path as the writer. */
export function computeRowHash(prevHash: Uint8Array, payload: Buffer): Uint8Array {
  const h = createHash('sha256');
  h.update(prevHash);
  h.update(payload);
  if (env.AUDIT_HASH_SECRET) h.update(env.AUDIT_HASH_SECRET);
  return new Uint8Array(h.digest());
}

/**
 * Record an audit event. MUST run inside the same tx as the domain change.
 * SELECT … FOR UPDATE on the last row serialises concurrent appenders.
 */
export async function recordAuditEvent(
  tx: Tx,
  ev: AuditEventInput,
): Promise<void> {
  const previous = await tx
    .select({ rowHash: auditLog.rowHash })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1)
    .for('update');

  const prevHash: Uint8Array =
    previous.length > 0 ? new Uint8Array(previous[0].rowHash) : GENESIS_PREV_HASH;

  const occurredAt = ev.occurredAt ?? new Date();
  const payload = payloadBytes(ev, prevHash, occurredAt);
  const rowHash = computeRowHash(prevHash, payload);

  await tx.insert(auditLog).values({
    occurredAt,
    actorId: ev.actorId,
    actorRole: ev.actorRole,
    action: ev.action,
    resourceType: ev.resourceType,
    resourceId: ev.resourceId,
    beforeState: ev.beforeState ?? null,
    afterState: ev.afterState ?? null,
    metadata: ev.metadata ?? {},
    prevHash,
    rowHash,
  });
}

/** Re-compute row_hash for an existing row. Used by the verifier. */
export function expectedRowHash(row: {
  occurredAt: Date;
  actorId: string;
  actorRole: NewAuditLogRow['actorRole'];
  action: string;
  resourceType: string;
  resourceId: string;
  beforeState: unknown;
  afterState: unknown;
  metadata: Record<string, unknown>;
  prevHash: Uint8Array;
}): Uint8Array {
  const payload = payloadBytes(row, new Uint8Array(row.prevHash), row.occurredAt);
  return computeRowHash(new Uint8Array(row.prevHash), payload);
}

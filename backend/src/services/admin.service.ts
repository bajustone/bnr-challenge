/**
 * Role grants + audit-chain verification. Verifier reuses
 * `expectedRowHash` so its canonical-JSON contract can't drift from the
 * writer's.
 */

import { db } from '../db/index.ts';
import { ForbiddenError, NotFoundError } from '../errors.ts';
import { makeRepos } from '../repositories/index.ts';
import {
  GENESIS_PREV_HASH,
  expectedRowHash,
} from '../db/audit-hash.ts';
import type { Role } from 'bnr-shared';
import type { AuditLogRow, User } from '../db/schema.ts';

export type Actor = {
  id: string;
  roles: Role[];
  requestId?: string;
};

export type UserWithRoles = User & { roles: Role[] };

export async function listUsers(_actor: Actor): Promise<UserWithRoles[]> {
  const repos = makeRepos(db);
  const users = await repos.users.listActive();
  const out: UserWithRoles[] = [];
  for (const u of users) {
    const roles = await repos.userRoles.listForUser(u.id);
    out.push({ ...u, roles });
  }
  return out;
}

export async function grantRole(
  actor: Actor,
  args: { userId: string; role: Role },
): Promise<void> {
  if (!actor.roles.includes('admin')) {
    throw new ForbiddenError('admin only');
  }
  await db.transaction(async (tx) => {
    const repos = makeRepos(tx);
    const target = await repos.users.findById(args.userId);
    if (!target) throw new NotFoundError('user not found');

    const granted = await repos.userRoles.grant({
      userId: args.userId,
      role: args.role,
      grantedBy: actor.id,
    });

    await repos.audit.append({
      actorId: actor.id,
      actorRole: 'admin',
      action: 'user_role.granted',
      resourceType: 'user',
      resourceId: args.userId,
      afterState: { role: granted.role, granted_by: granted.grantedBy },
      metadata: { request_id: actor.requestId ?? null },
    });
  });
}

export async function revokeRole(
  actor: Actor,
  args: { userId: string; role: Role },
): Promise<void> {
  if (!actor.roles.includes('admin')) {
    throw new ForbiddenError('admin only');
  }
  await db.transaction(async (tx) => {
    const repos = makeRepos(tx);
    const ok = await repos.userRoles.revoke({ userId: args.userId, role: args.role });
    if (!ok) throw new NotFoundError('role not held by user');

    await repos.audit.append({
      actorId: actor.id,
      actorRole: 'admin',
      action: 'user_role.revoked',
      resourceType: 'user',
      resourceId: args.userId,
      beforeState: { role: args.role },
      metadata: { request_id: actor.requestId ?? null },
    });
  });
}

export type VerifyResult = {
  ok: boolean;
  lastVerifiedId: string | null;
  firstBadId: string | null;
  reason?: string;
  rowsChecked: number;
};

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function verifyChain(actor: Actor): Promise<VerifyResult> {
  if (!actor.roles.includes('admin')) {
    throw new ForbiddenError('admin only');
  }
  const repos = makeRepos(db);
  const rows = await repos.audit.listAllOrdered();
  let prev: Uint8Array = GENESIS_PREV_HASH;
  let lastOk: bigint | null = null;
  for (const raw of rows) {
    const row = raw as AuditLogRow;
    const prevHashBytes = new Uint8Array(row.prevHash);
    const rowHashBytes = new Uint8Array(row.rowHash);
    if (!equalBytes(prevHashBytes, prev)) {
      return {
        ok: false,
        lastVerifiedId: lastOk?.toString() ?? null,
        firstBadId: row.id.toString(),
        reason: 'prev_hash_mismatch',
        rowsChecked: rows.length,
      };
    }
    const expected = expectedRowHash({
      occurredAt: row.occurredAt,
      actorId: row.actorId,
      actorRole: row.actorRole,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      beforeState: row.beforeState,
      afterState: row.afterState,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      prevHash: prevHashBytes,
    });
    if (!equalBytes(rowHashBytes, expected)) {
      return {
        ok: false,
        lastVerifiedId: lastOk?.toString() ?? null,
        firstBadId: row.id.toString(),
        reason: 'row_hash_mismatch',
        rowsChecked: rows.length,
      };
    }
    prev = rowHashBytes;
    lastOk = row.id;
  }
  return {
    ok: true,
    lastVerifiedId: lastOk?.toString() ?? null,
    firstBadId: null,
    rowsChecked: rows.length,
  };
}

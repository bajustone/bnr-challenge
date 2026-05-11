/** Audit-log reads + `append` shim over `recordAuditEvent`. Append-only at the engine level. */

import { and, asc, eq, type SQL } from 'drizzle-orm';

import { auditLog, type AuditLogRow } from '../db/schema.ts';
import { recordAuditEvent } from '../db/audit-hash.ts';
import type { DbOrTx } from './types.ts';

export type AppendAuditInput = Parameters<typeof recordAuditEvent>[1];

export function makeAuditRepo(h: DbOrTx) {
  return {
    async listForResource(args: {
      resourceType: string;
      resourceId: string;
      limit?: number;
    }): Promise<AuditLogRow[]> {
      const limit = args.limit ?? 200;
      return h
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.resourceType, args.resourceType),
            eq(auditLog.resourceId, args.resourceId),
          ),
        )
        .orderBy(asc(auditLog.id))
        .limit(limit);
    },

    async list(args: {
      actorId?: string;
      resourceType?: string;
      resourceId?: string;
      limit?: number;
      offset?: number;
    }): Promise<AuditLogRow[]> {
      const conds: SQL[] = [];
      if (args.actorId) conds.push(eq(auditLog.actorId, args.actorId));
      if (args.resourceType) conds.push(eq(auditLog.resourceType, args.resourceType));
      if (args.resourceId) conds.push(eq(auditLog.resourceId, args.resourceId));
      const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
      return h
        .select()
        .from(auditLog)
        .where(where as SQL | undefined)
        .orderBy(asc(auditLog.id))
        .limit(args.limit ?? 200)
        .offset(args.offset ?? 0);
    },

    /** Chain order, ascending — the verifier walks this. */
    async listAllOrdered(): Promise<AuditLogRow[]> {
      return h.select().from(auditLog).orderBy(asc(auditLog.id));
    },

    append(ev: AppendAuditInput): Promise<void> {
      return recordAuditEvent(h, ev);
    },
  };
}

export type AuditRepo = ReturnType<typeof makeAuditRepo>;

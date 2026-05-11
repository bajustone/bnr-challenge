/**
 * `transitionWithVersion` is the optimistic-locking UPDATE: gates on
 * (id, expectedVersion, expectedStatus), returns undefined on conflict
 * → service maps to 409. Callers must be inside a tx and append a
 * matching audit row in the same tx.
 */

import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { applications, type Application } from '../db/schema.ts';
import type {
  ApplicationStatus,
  DecisionKind,
  TransitionPatch,
} from 'bnr-shared';
import type { DbOrTx } from './types.ts';

export type CreateApplicationInput = {
  id?: string;
  applicantId: string;
  institutionName: string;
  institutionType: string;
  payload?: Record<string, unknown>;
};

export type UpdateDraftInput = {
  institutionName?: string;
  institutionType?: string;
  payload?: Record<string, unknown>;
};

export type ListApplicationsOptions = {
  /** Restrict to applications owned by this user (for applicant view). */
  applicantId?: string;
  status?: ApplicationStatus | ApplicationStatus[];
  limit?: number;
  offset?: number;
};

export function makeApplicationsRepo(h: DbOrTx) {
  return {
    async findById(id: string): Promise<Application | undefined> {
      const [row] = await h.select().from(applications).where(eq(applications.id, id)).limit(1);
      return row;
    },

    async create(input: CreateApplicationInput): Promise<Application> {
      const [row] = await h
        .insert(applications)
        .values({
          id: input.id,
          applicantId: input.applicantId,
          institutionName: input.institutionName,
          institutionType: input.institutionType,
          payload: input.payload ?? {},
        })
        .returning();
      if (!row) throw new Error('applications insert returned no row');
      return row;
    },

    /** WHERE clause restricts to DRAFT / RFI_REQUESTED — trigger blocks elsewhere. */
    async updateDraft(args: {
      id: string;
      expectedVersion: number;
      patch: UpdateDraftInput;
    }): Promise<Application | undefined> {
      const setClause: Record<string, unknown> = { updatedAt: sql`now()` };
      if (args.patch.institutionName !== undefined) {
        setClause['institutionName'] = args.patch.institutionName;
      }
      if (args.patch.institutionType !== undefined) {
        setClause['institutionType'] = args.patch.institutionType;
      }
      if (args.patch.payload !== undefined) {
        setClause['payload'] = args.patch.payload;
      }
      const [row] = await h
        .update(applications)
        .set(setClause)
        .where(
          and(
            eq(applications.id, args.id),
            eq(applications.version, args.expectedVersion),
            inArray(applications.status, ['DRAFT', 'RFI_REQUESTED']),
          ),
        )
        .returning();
      return row;
    },

    async transitionWithVersion(args: {
      id: string;
      expectedVersion: number;
      expectedStatus: ApplicationStatus;
      patch: TransitionPatch;
      reason?: string | null;
    }): Promise<Application | undefined> {
      const { patch } = args;
      const setClause: Record<string, SQL | unknown> = {
        status: patch.nextStatus,
        version: sql`${applications.version} + 1`,
        updatedAt: sql`now()`,
      };
      if (patch.reviewedBy) setClause['reviewedBy'] = patch.reviewedBy;
      if (patch.decidedBy) setClause['decidedBy'] = patch.decidedBy;
      if (patch.decision) setClause['decision'] = patch.decision as DecisionKind;
      if (patch.setSubmittedAt) setClause['submittedAt'] = sql`now()`;
      if (patch.setReviewedAt) setClause['reviewedAt'] = sql`now()`;
      if (patch.setDecidedAt) setClause['decidedAt'] = sql`now()`;
      if (args.reason !== undefined) setClause['decisionReason'] = args.reason;

      const [row] = await h
        .update(applications)
        .set(setClause)
        .where(
          and(
            eq(applications.id, args.id),
            eq(applications.version, args.expectedVersion),
            eq(applications.status, args.expectedStatus),
          ),
        )
        .returning();
      return row;
    },

    async list(opts: ListApplicationsOptions = {}): Promise<Application[]> {
      const conds: SQL[] = [];
      if (opts.applicantId) conds.push(eq(applications.applicantId, opts.applicantId));
      if (opts.status) {
        const ss = Array.isArray(opts.status) ? opts.status : [opts.status];
        conds.push(inArray(applications.status, ss));
      }
      const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      return h
        .select()
        .from(applications)
        .where(where as SQL | undefined)
        .orderBy(desc(applications.createdAt))
        .limit(limit)
        .offset(offset);
    },
  };
}

export type ApplicationsRepo = ReturnType<typeof makeApplicationsRepo>;

/** Audit before/after canonical shape. snake_case to match SQL column names. */
export function snapshotApplication(app: Application): Record<string, unknown> {
  return {
    id: app.id,
    applicant_id: app.applicantId,
    institution_name: app.institutionName,
    institution_type: app.institutionType,
    status: app.status,
    version: app.version,
    submitted_at: app.submittedAt?.toISOString() ?? null,
    reviewed_by: app.reviewedBy,
    reviewed_at: app.reviewedAt?.toISOString() ?? null,
    decided_by: app.decidedBy,
    decided_at: app.decidedAt?.toISOString() ?? null,
    decision: app.decision,
    decision_reason: app.decisionReason,
  };
}

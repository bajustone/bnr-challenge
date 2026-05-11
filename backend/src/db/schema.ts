/**
 * Drizzle schema. Companion: docs/db-architecture.html (the *why*).
 * Grants, triggers, citext, extensions live in backend/migrations/sql/.
 */

import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Custom column types. citext requires the extension installed in pre/0001.
const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

// Workflow states. Adding one = migration + state-machine code change.
export const applicationStatus = pgEnum('application_status', [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'RFI_REQUESTED',
  'READY_FOR_DECISION',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
]);

export const decisionKind = pgEnum('decision_kind', ['APPROVED', 'REJECTED']);

// Dual control is enforced per-application (chk_dual_control), not by role.
export const appRole = pgEnum('app_role', [
  'applicant',
  'reviewer',
  'approver',
  'admin',
]);

// Tables below match better-auth's expected shape so its drizzle adapter
// can map field-for-field without aliases. Extra columns we own (e.g.
// disabledAt) live alongside; better-auth ignores them.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  email: citext('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Soft-disable only — audit_log references user ids forever.
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_sessions_user').on(t.userId),
    expiresIdx: index('idx_sessions_expires').on(t.expiresAt),
  }),
);

// Holds the argon2id hash for the 'credential' provider plus OAuth tokens.
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    providerAccountUniq: unique('uniq_accounts_provider_account').on(t.providerId, t.accountId),
    userIdx: index('idx_accounts_user').on(t.userId),
  }),
);

// Short-lived tokens for email verification / password reset.
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    identifierIdx: index('idx_verifications_identifier').on(t.identifier),
  }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: appRole('role').notNull(),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => users.id),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.role] }),
  }),
);

/**
 * Optimistic locking: state-changing UPDATEs must include
 * `WHERE id = ? AND version = ? AND status = ?` and check rowcount.
 * Terminal-state immutability is enforced by trigger (post/0003).
 */
export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    institutionName: text('institution_name').notNull(),
    institutionType: text('institution_type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),

    status: applicationStatus('status').notNull().default('DRAFT'),
    version: integer('version').notNull().default(0),

    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decision: decisionKind('decision'),
    decisionReason: text('decision_reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Reviewer ≠ approver when both set (NULLs allowed for in-flight rows).
    chkDualControl: check(
      'chk_dual_control',
      sql`${t.decidedBy} IS NULL OR ${t.reviewedBy} IS NULL OR ${t.decidedBy} <> ${t.reviewedBy}`,
    ),
    chkTerminalComplete: check(
      'chk_terminal_complete',
      sql`(${t.status} NOT IN ('APPROVED','REJECTED'))
          OR (${t.decision} IS NOT NULL AND ${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    chkDecisionMatches: check(
      'chk_decision_matches',
      sql`(${t.decision} IS NULL)
          OR (${t.decision} = 'APPROVED' AND ${t.status} = 'APPROVED')
          OR (${t.decision} = 'REJECTED' AND ${t.status} = 'REJECTED')`,
    ),
    applicantIdx: index('idx_applications_applicant').on(t.applicantId),
    reviewerIdx: index('idx_applications_reviewer')
      .on(t.reviewedBy)
      .where(sql`${t.reviewedBy} IS NOT NULL`),
    // Active workload only — terminal rows are never filtered by status.
    activeStatusIdx: index('idx_applications_status')
      .on(t.status)
      .where(sql`${t.status} NOT IN ('APPROVED','REJECTED','WITHDRAWN')`),
  }),
);

/**
 * Content-addressed by sha256. Bytes on disk at ./storage/<aa>/<sha256>.
 * 5MB cap is the last line of defence (middleware + stream counter stop earlier).
 */
export const documentBlobs = pgTable(
  'document_blobs',
  {
    sha256: bytea('sha256').primaryKey(),
    sizeBytes: integer('size_bytes').notNull(),
    storagePath: text('storage_path').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    chkSize5mb: check(
      'chk_blob_size_5mb',
      sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 5 * 1024 * 1024`,
    ),
  }),
);

/**
 * Versioned per (application_id, slot). RFI resubmission = new row with
 * version+1. superseded_at + partial index keeps "current set" cheap.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'restrict' }),
    slot: text('slot').notNull(),
    version: integer('version').notNull(),

    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    contentSha256: bytea('content_sha256')
      .notNull()
      .references(() => documentBlobs.sha256),

    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => ({
    uniqSlotVersion: uniqueIndex('uniq_slot_version').on(
      t.applicationId,
      t.slot,
      t.version,
    ),
    chkVersionPos: check('chk_version_pos', sql`${t.version} >= 1`),
    chkSize5mb: check(
      'chk_doc_size_5mb',
      sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 5 * 1024 * 1024`,
    ),
    appIdx: index('idx_documents_app').on(t.applicationId),
    currentSlotIdx: index('idx_documents_current_slot')
      .on(t.applicationId, t.slot)
      .where(sql`${t.supersededAt} IS NULL`),
  }),
);

/**
 * Append-only commentary attached to an application. Carries the RFI message
 * (visibility='applicant') and reviewer-internal notes (visibility='staff').
 * Two defences: SELECT/INSERT-only grant on app_user, plus an audit_log row
 * per insert. No hash chain — cross-row tamper-evidence already lives there.
 */
export const reviewNotes = pgTable(
  'review_notes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'restrict' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    // Snapshot of the role under which the note was written. Lets the UI
    // attribute commentary correctly even after a role grant is revoked.
    authorRole: appRole('author_role').notNull(),
    visibility: text('visibility').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    chkVisibility: check(
      'chk_review_notes_visibility',
      sql`${t.visibility} IN ('staff', 'applicant')`,
    ),
    chkBodyLen: check(
      'chk_review_notes_body_len',
      sql`length(${t.body}) BETWEEN 1 AND 10000`,
    ),
    appIdx: index('idx_review_notes_app').on(t.applicationId, t.createdAt),
  }),
);

/**
 * Append-only. Three defences: grants (post/0002), trigger (post/0003),
 * hash chain (recordAuditEvent in audit-hash.ts).
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    actorRole: appRole('actor_role').notNull(),
    action: text('action').notNull(), // e.g. 'application.submit'
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(), // text — future resource types
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    prevHash: bytea('prev_hash').notNull(), // genesis = 32 zero bytes
    rowHash: bytea('row_hash').notNull(),
  },
  (t) => ({
    resourceIdx: index('idx_audit_resource').on(
      t.resourceType,
      t.resourceId,
      t.id,
    ),
    actorIdx: index('idx_audit_actor').on(t.actorId, t.id),
    timeIdx: index('idx_audit_time').on(t.occurredAt),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;

export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export type DocumentBlob = typeof documentBlobs.$inferSelect;
export type NewDocumentBlob = typeof documentBlobs.$inferInsert;

export type ReviewNote = typeof reviewNotes.$inferSelect;
export type NewReviewNote = typeof reviewNotes.$inferInsert;
export type ReviewNoteVisibility = 'staff' | 'applicant';

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;

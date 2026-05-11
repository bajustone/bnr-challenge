/**
 * Domain row -> API payload. Centralised so the JSON shape stays stable
 * across schema changes that don't change the API. Dates → ISO strings,
 * bigints → strings (JSON has no native bigint), bytea → hex.
 */

import type {
  Application,
  AuditLogRow,
  Document,
  ReviewNote,
} from '../db/schema.ts';

const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function serialiseApplication(a: Application) {
  return {
    id: a.id,
    applicantId: a.applicantId,
    institutionName: a.institutionName,
    institutionType: a.institutionType,
    payload: (a.payload ?? {}) as Record<string, unknown>,
    status: a.status,
    version: a.version,
    submittedAt: isoOrNull(a.submittedAt),
    reviewedBy: a.reviewedBy,
    reviewedAt: isoOrNull(a.reviewedAt),
    decidedBy: a.decidedBy,
    decidedAt: isoOrNull(a.decidedAt),
    decision: a.decision,
    decisionReason: a.decisionReason,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function serialiseDocument(d: Document) {
  return {
    id: d.id,
    applicationId: d.applicationId,
    slot: d.slot,
    version: d.version,
    filename: d.filename,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    sha256: Buffer.from(d.contentSha256).toString('hex'),
    uploadedBy: d.uploadedBy,
    uploadedAt: d.uploadedAt.toISOString(),
    supersededAt: isoOrNull(d.supersededAt),
  };
}

export function serialiseReviewNote(n: ReviewNote) {
  return {
    id: n.id,
    applicationId: n.applicationId,
    authorId: n.authorId,
    authorRole: n.authorRole,
    visibility: n.visibility as 'staff' | 'applicant',
    body: n.body,
    createdAt: n.createdAt.toISOString(),
  };
}

export function serialiseAuditRow(r: AuditLogRow) {
  return {
    id: r.id.toString(),
    occurredAt: r.occurredAt.toISOString(),
    actorId: r.actorId,
    actorRole: r.actorRole,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    beforeState: r.beforeState,
    afterState: r.afterState,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  };
}

/** Zod schemas shared between handlers + OpenAPI. One source of truth. */

import { z } from 'zod';

import {
  APPLICATION_STATUSES,
  ROLES,
  TRANSITION_EVENTS,
} from 'bnr-shared';

export const ApplicationStatusSchema = z.enum(APPLICATION_STATUSES).meta({
  id: 'ApplicationStatus',
});

export const RoleSchema = z.enum(ROLES).meta({ id: 'Role' });

export const TransitionEventSchema = z.enum(TRANSITION_EVENTS).meta({
  id: 'TransitionEvent',
});

export const VisibilitySchema = z.enum(['staff', 'applicant']).meta({
  id: 'NoteVisibility',
});

export const Iso = z.iso.datetime();
export const Uuid = z.uuid();

export const ApplicationSchema = z
  .object({
    id: Uuid,
    applicantId: Uuid,
    institutionName: z.string(),
    institutionType: z.string(),
    payload: z.record(z.string(), z.unknown()),
    status: ApplicationStatusSchema,
    version: z.number().int().nonnegative(),
    submittedAt: Iso.nullable(),
    reviewedBy: Uuid.nullable(),
    reviewedAt: Iso.nullable(),
    decidedBy: Uuid.nullable(),
    decidedAt: Iso.nullable(),
    decision: z.enum(['APPROVED', 'REJECTED']).nullable(),
    decisionReason: z.string().nullable(),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .meta({ id: 'Application' });

export const CreateApplicationSchema = z
  .object({
    institutionName: z.string().min(1).max(200),
    institutionType: z.string().min(1).max(64),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'CreateApplicationInput' });

export const UpdateDraftSchema = z
  .object({
    institutionName: z.string().min(1).max(200).optional(),
    institutionType: z.string().min(1).max(64).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'UpdateDraftInput' });

export const TransitionInputSchema = z
  .object({
    event: TransitionEventSchema,
    message: z.string().min(1).max(10_000).optional(),
    reason: z.string().min(1).max(2_000).optional(),
  })
  .meta({ id: 'TransitionInput' });

export const ListApplicationsQuerySchema = z
  .object({
    status: z
      .union([ApplicationStatusSchema, z.array(ApplicationStatusSchema)])
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .meta({ id: 'ListApplicationsQuery' });

export const MeResponseSchema = z
  .object({
    user: z.object({
      id: Uuid,
      email: z.string(),
      name: z.string(),
    }),
    roles: z.array(RoleSchema),
  })
  .meta({ id: 'MeResponse' });

export const DocumentSchema = z
  .object({
    id: Uuid,
    applicationId: Uuid,
    slot: z.string(),
    version: z.number().int().positive(),
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    uploadedBy: Uuid,
    uploadedAt: Iso,
    supersededAt: Iso.nullable(),
  })
  .meta({ id: 'Document' });

export const ReviewNoteSchema = z
  .object({
    id: Uuid,
    applicationId: Uuid,
    authorId: Uuid,
    authorRole: RoleSchema,
    visibility: VisibilitySchema,
    body: z.string(),
    createdAt: Iso,
  })
  .meta({ id: 'ReviewNote' });

export const CreateReviewNoteSchema = z
  .object({
    visibility: VisibilitySchema,
    body: z.string().min(1).max(10_000),
  })
  .meta({ id: 'CreateReviewNoteInput' });

export const AuditRowSchema = z
  .object({
    id: z.string(),
    occurredAt: Iso,
    actorId: Uuid,
    actorRole: RoleSchema,
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string(),
    beforeState: z.unknown(),
    afterState: z.unknown(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'AuditRow' });

export const ErrorBodySchema = z
  .object({
    error: z.string(),
    requestId: z.string().optional(),
  })
  .catchall(z.unknown())
  .meta({ id: 'ErrorBody' });

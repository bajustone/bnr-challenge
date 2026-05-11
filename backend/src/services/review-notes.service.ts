/**
 * Staff posts; applicant reads only their visibility set. RFI message
 * creation is owned by `request_info` in applications.service, not here.
 */

import { db } from '../db/index.ts';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.ts';
import { makeRepos } from '../repositories/index.ts';
import {
  canPostReviewNote,
  canViewApplication,
  visibilityFilterFor,
} from '../auth/policy.ts';
import type { Role } from 'bnr-shared';
import type { ReviewNote, ReviewNoteVisibility } from '../db/schema.ts';

export type Actor = {
  id: string;
  roles: Role[];
  requestId?: string;
};

export type CreateNoteInput = {
  applicationId: string;
  visibility: ReviewNoteVisibility;
  body: string;
};

function staffRoleFor(roles: readonly Role[]): Role {
  if (roles.includes('reviewer')) return 'reviewer';
  if (roles.includes('approver')) return 'approver';
  if (roles.includes('admin')) return 'admin';
  // Unreachable when canPostReviewNote gated; defensive.
  throw new ForbiddenError('staff role required');
}

export async function create(actor: Actor, input: CreateNoteInput): Promise<ReviewNote> {
  if (!canPostReviewNote({ userId: actor.id, roles: actor.roles })) {
    throw new ForbiddenError('only staff can post review notes');
  }
  const body = input.body?.trim();
  if (!body) throw new ValidationError('body required');
  if (body.length > 10_000) throw new ValidationError('body too long', { maxLen: 10_000 });

  return db.transaction(async (tx) => {
    const repos = makeRepos(tx);
    const app = await repos.applications.findById(input.applicationId);
    if (!app) throw new NotFoundError('application not found');

    const authorRole = staffRoleFor(actor.roles);
    const note = await repos.reviewNotes.create({
      applicationId: input.applicationId,
      authorId: actor.id,
      authorRole,
      visibility: input.visibility,
      body,
    });

    await repos.audit.append({
      actorId: actor.id,
      actorRole: authorRole,
      action: 'review_note.created',
      resourceType: 'review_note',
      resourceId: note.id,
      afterState: {
        application_id: note.applicationId,
        visibility: note.visibility,
        author_role: note.authorRole,
      },
      metadata: { request_id: actor.requestId ?? null },
    });
    return note;
  });
}

export async function listForApplication(
  actor: Actor,
  applicationId: string,
): Promise<ReviewNote[]> {
  const repos = makeRepos(db);
  const app = await repos.applications.findById(applicationId);
  if (!app) throw new NotFoundError('application not found');
  if (!canViewApplication({ userId: actor.id, roles: actor.roles }, app)) {
    throw new ForbiddenError('actor cannot view this application');
  }
  const filter = visibilityFilterFor({ userId: actor.id, roles: actor.roles });
  return repos.reviewNotes.listForApplication(applicationId, {
    visibilities: filter ?? undefined,
  });
}

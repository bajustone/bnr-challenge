/**
 * Every mutation: one tx, one audit row. SM rejection → mapStateMachineError
 * (403/409/422); predicated UPDATE = 0 → ConcurrentUpdateError (409).
 */

import {
  transition,
  type ApplicationStatus,
  type Role,
  type TransitionEvent,
} from 'bnr-shared';

import { db } from '../db/index.ts';
import {
  ConcurrentUpdateError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  mapStateMachineError,
} from '../errors.ts';
import { makeRepos, type Repos } from '../repositories/index.ts';
import { snapshotApplication } from '../repositories/applications.repo.ts';
import { canEditDraft, canViewApplication } from '../auth/policy.ts';
import type { Application } from '../db/schema.ts';

export type Actor = {
  id: string;
  roles: Role[];
  requestId?: string;
};

export type CreateInput = {
  institutionName: string;
  institutionType: string;
  payload?: Record<string, unknown>;
};

export type UpdateDraftInput = {
  institutionName?: string;
  institutionType?: string;
  payload?: Record<string, unknown>;
};

export type TransitionInput = {
  event: TransitionEvent;
  /** Required for `request_info`; ignored otherwise. */
  message?: string;
  /** Optional reviewer/approver commentary stamped onto the row + audit. */
  reason?: string;
};

export async function createDraft(actor: Actor, input: CreateInput): Promise<Application> {
  return db.transaction(async (tx) => {
    const repos = makeRepos(tx);
    const app = await repos.applications.create({
      applicantId: actor.id,
      institutionName: input.institutionName,
      institutionType: input.institutionType,
      payload: input.payload,
    });
    await repos.audit.append({
      actorId: actor.id,
      actorRole: 'applicant',
      action: 'application.created',
      resourceType: 'application',
      resourceId: app.id,
      afterState: snapshotApplication(app),
      metadata: { request_id: actor.requestId ?? null },
    });
    return app;
  });
}

export async function getById(actor: Actor, id: string): Promise<Application> {
  const repos = makeRepos(db);
  const app = await repos.applications.findById(id);
  if (!app) throw new NotFoundError('application not found');
  if (!canViewApplication({ userId: actor.id, roles: actor.roles }, app)) {
    throw new ForbiddenError('actor cannot view this application');
  }
  return app;
}

export async function list(
  actor: Actor,
  opts: { status?: ApplicationStatus | ApplicationStatus[]; limit?: number; offset?: number },
): Promise<Application[]> {
  const repos = makeRepos(db);
  const isStaff =
    actor.roles.includes('reviewer') ||
    actor.roles.includes('approver') ||
    actor.roles.includes('admin');
  return repos.applications.list({
    ...opts,
    applicantId: isStaff ? undefined : actor.id,
  });
}

export async function updateDraft(
  actor: Actor,
  id: string,
  patch: UpdateDraftInput,
): Promise<Application> {
  return db.transaction(async (tx) => {
    const repos = makeRepos(tx);
    const app = await repos.applications.findById(id);
    if (!app) throw new NotFoundError('application not found');
    if (!canEditDraft({ userId: actor.id, roles: actor.roles }, app)) {
      throw new ForbiddenError('only the applicant can edit this application');
    }
    if (app.status !== 'DRAFT' && app.status !== 'RFI_REQUESTED') {
      throw new ValidationError('application not editable in this status', {
        status: app.status,
      });
    }
    const updated = await repos.applications.updateDraft({
      id: app.id,
      expectedVersion: app.version,
      patch,
    });
    if (!updated) throw new ConcurrentUpdateError();
    await repos.audit.append({
      actorId: actor.id,
      actorRole: 'applicant',
      action: 'application.updated',
      resourceType: 'application',
      resourceId: app.id,
      beforeState: snapshotApplication(app),
      afterState: snapshotApplication(updated),
      metadata: { request_id: actor.requestId ?? null },
    });
    return updated;
  });
}

export async function applyTransition(
  actor: Actor,
  id: string,
  input: TransitionInput,
): Promise<Application> {
  return db.transaction(async (tx) => {
    const repos = makeRepos(tx);
    const app = await repos.applications.findById(id);
    if (!app) throw new NotFoundError('application not found');

    const result = transition({
      currentStatus: app.status,
      event: input.event,
      actor: { id: actor.id, roles: actor.roles },
      application: {
        applicantId: app.applicantId,
        reviewedBy: app.reviewedBy,
        decidedBy: app.decidedBy,
      },
      message: input.message,
    });
    if (!result.ok) {
      throw mapStateMachineError({
        from: app.status,
        event: input.event,
        reason: result.reason,
      });
    }

    const updated = await repos.applications.transitionWithVersion({
      id: app.id,
      expectedVersion: app.version,
      expectedStatus: app.status,
      patch: result.patch,
      reason: input.reason ?? null,
    });
    if (!updated) throw new ConcurrentUpdateError();

    // request_info pins the RFI message as an applicant-visible note; same tx.
    if (input.event === 'request_info' && input.message) {
      const note = await repos.reviewNotes.create({
        applicationId: app.id,
        authorId: actor.id,
        authorRole: result.actorRole,
        visibility: 'applicant',
        body: input.message,
      });
      await repos.audit.append({
        actorId: actor.id,
        actorRole: result.actorRole,
        action: 'review_note.created',
        resourceType: 'review_note',
        resourceId: note.id,
        afterState: {
          application_id: note.applicationId,
          visibility: note.visibility,
          author_role: note.authorRole,
        },
        metadata: { request_id: actor.requestId ?? null, source: 'transition.request_info' },
      });
    }

    await repos.audit.append({
      actorId: actor.id,
      actorRole: result.actorRole,
      action: `application.${result.eventName}`,
      resourceType: 'application',
      resourceId: app.id,
      beforeState: snapshotApplication(app),
      afterState: snapshotApplication(updated),
      metadata: {
        request_id: actor.requestId ?? null,
        event: result.eventName,
        reason: input.reason ?? null,
      },
    });

    return updated;
  });
}

export async function history(
  actor: Actor,
  id: string,
): Promise<Awaited<ReturnType<Repos['audit']['listForResource']>>> {
  await getById(actor, id); // authz + 404 in one
  return makeRepos(db).audit.listForResource({
    resourceType: 'application',
    resourceId: id,
  });
}

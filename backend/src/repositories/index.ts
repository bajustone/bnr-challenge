/** Repos aggregate. Services call `makeRepos(tx)` inside `db.transaction`. */

import { makeApplicationsRepo, type ApplicationsRepo } from './applications.repo.ts';
import { makeAuditRepo, type AuditRepo } from './audit.repo.ts';
import { makeDocumentBlobsRepo, type DocumentBlobsRepo } from './document-blobs.repo.ts';
import { makeDocumentsRepo, type DocumentsRepo } from './documents.repo.ts';
import { makeReviewNotesRepo, type ReviewNotesRepo } from './review-notes.repo.ts';
import { makeUserRolesRepo, type UserRolesRepo } from './user-roles.repo.ts';
import { makeUsersRepo, type UsersRepo } from './users.repo.ts';
import type { DbOrTx } from './types.ts';

export type Repos = {
  applications: ApplicationsRepo;
  audit: AuditRepo;
  documentBlobs: DocumentBlobsRepo;
  documents: DocumentsRepo;
  reviewNotes: ReviewNotesRepo;
  userRoles: UserRolesRepo;
  users: UsersRepo;
};

export function makeRepos(h: DbOrTx): Repos {
  return {
    applications: makeApplicationsRepo(h),
    audit: makeAuditRepo(h),
    documentBlobs: makeDocumentBlobsRepo(h),
    documents: makeDocumentsRepo(h),
    reviewNotes: makeReviewNotesRepo(h),
    userRoles: makeUserRolesRepo(h),
    users: makeUsersRepo(h),
  };
}

export * from './applications.repo.ts';
export * from './audit.repo.ts';
export * from './document-blobs.repo.ts';
export * from './documents.repo.ts';
export * from './review-notes.repo.ts';
export * from './user-roles.repo.ts';
export * from './users.repo.ts';
export type { DbOrTx, DbHandle, Tx } from './types.ts';

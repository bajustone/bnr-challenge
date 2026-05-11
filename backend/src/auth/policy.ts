/** Per-record visibility: applicants own, staff see all. Same rule for GET / download / note read. */

import type { Role } from 'bnr-shared';

import { hasStaffRole } from './middleware.ts';

export type Viewer = {
  userId: string;
  roles: readonly Role[];
};

export type ApplicationLite = {
  applicantId: string;
};

export function canViewApplication(viewer: Viewer, app: ApplicationLite): boolean {
  if (hasStaffRole(viewer.roles)) return true;
  return app.applicantId === viewer.userId;
}

export function canEditDraft(viewer: Viewer, app: ApplicationLite): boolean {
  return app.applicantId === viewer.userId && viewer.roles.includes('applicant');
}

export function canPostReviewNote(viewer: Viewer): boolean {
  return hasStaffRole(viewer.roles);
}

/** null = no filter (staff); applicants only see notes addressed to them. */
export function visibilityFilterFor(viewer: Viewer): ('applicant' | 'staff')[] | null {
  if (hasStaffRole(viewer.roles)) return null;
  return ['applicant'];
}

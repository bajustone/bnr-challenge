/**
 * Role × route authorisation. Proves the brief's two big asks:
 *   - 403 (not 404) on unauthorised access where the resource exists
 *   - applicants see only their own, staff see all
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { appFetch, createTestUser, type TestUser } from './helpers/auth.ts';

let admin: TestUser;
let applicant: TestUser;
let otherApplicant: TestUser;
let reviewer: TestUser;
let approver: TestUser;
let appId: string;
let otherAppId: string;

beforeAll(async () => {
  admin = await createTestUser({ label: 'authz-admin', roles: ['admin'] });
  applicant = await createTestUser({
    label: 'authz-applicant',
    roles: ['applicant'],
    grantedBy: admin.id,
  });
  otherApplicant = await createTestUser({
    label: 'authz-other-applicant',
    roles: ['applicant'],
    grantedBy: admin.id,
  });
  reviewer = await createTestUser({
    label: 'authz-reviewer',
    roles: ['reviewer'],
    grantedBy: admin.id,
  });
  approver = await createTestUser({
    label: 'authz-approver',
    roles: ['approver'],
    grantedBy: admin.id,
  });

  const create = await appFetch('/applications', {
    method: 'POST',
    user: applicant,
    json: { institutionName: 'Bank of Authz', institutionType: 'commercial_bank' },
  });
  expect(create.status).toBe(201);
  appId = ((await create.json()) as { id: string }).id;

  const other = await appFetch('/applications', {
    method: 'POST',
    user: otherApplicant,
    json: { institutionName: 'Other Bank', institutionType: 'commercial_bank' },
  });
  expect(other.status).toBe(201);
  otherAppId = ((await other.json()) as { id: string }).id;
});

describe('unauthenticated traffic', () => {
  it('GET /me returns 401', async () => {
    const res = await appFetch('/me');
    expect(res.status).toBe(401);
  });
  it('GET /applications returns 401', async () => {
    const res = await appFetch('/applications');
    expect(res.status).toBe(401);
  });
});

describe('listing scopes', () => {
  it('applicant sees only their own applications', async () => {
    const res = await appFetch('/applications', { user: applicant });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; applicantId: string }>;
    expect(rows.every((r) => r.applicantId === applicant.id)).toBe(true);
    expect(rows.some((r) => r.id === appId)).toBe(true);
    expect(rows.some((r) => r.id === otherAppId)).toBe(false);
  });

  it('staff (reviewer) sees applications from every applicant', async () => {
    const res = await appFetch('/applications', { user: reviewer });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows.some((r) => r.id === appId)).toBe(true);
    expect(rows.some((r) => r.id === otherAppId)).toBe(true);
  });
});

describe('per-record visibility', () => {
  it('a different applicant gets 403 (not 404) reading a peer application', async () => {
    const res = await appFetch(`/applications/${appId}`, { user: otherApplicant });
    expect(res.status).toBe(403);
  });

  it('reviewer can read any application', async () => {
    const res = await appFetch(`/applications/${appId}`, { user: reviewer });
    expect(res.status).toBe(200);
  });

  it('approver can read any application', async () => {
    const res = await appFetch(`/applications/${appId}`, { user: approver });
    expect(res.status).toBe(200);
  });
});

describe('admin-only routes', () => {
  it('reviewer is rejected from /admin/users', async () => {
    const res = await appFetch('/admin/users', { user: reviewer });
    expect(res.status).toBe(403);
  });
  it('applicant is rejected from /admin/audit/verify', async () => {
    const res = await appFetch('/admin/audit/verify', { user: applicant });
    expect(res.status).toBe(403);
  });
  it('admin can list users', async () => {
    const res = await appFetch('/admin/users', { user: admin });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows.length).toBeGreaterThan(0);
  });
  it('admin can verify the audit chain', async () => {
    const res = await appFetch('/admin/audit/verify', { user: admin });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('transitions', () => {
  it('applicant cannot mark_ready their own application', async () => {
    const res = await appFetch(`/applications/${appId}/transitions`, {
      method: 'POST',
      user: applicant,
      json: { event: 'mark_ready' },
    });
    // mark_ready is illegal from DRAFT regardless of role → 409 illegal_transition
    expect([403, 409]).toContain(res.status);
  });

  it('applicant can submit their own DRAFT', async () => {
    const res = await appFetch(`/applications/${appId}/transitions`, {
      method: 'POST',
      user: applicant,
      json: { event: 'submit' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('SUBMITTED');
  });

  it('reviewer can assign an application to themselves', async () => {
    const res = await appFetch(`/applications/${appId}/transitions`, {
      method: 'POST',
      user: reviewer,
      json: { event: 'assign' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; reviewedBy: string };
    expect(body.status).toBe('UNDER_REVIEW');
    expect(body.reviewedBy).toBe(reviewer.id);
  });

  it('reviewer cannot approve (forbidden_role → 403)', async () => {
    // First take to READY_FOR_DECISION
    await appFetch(`/applications/${appId}/transitions`, {
      method: 'POST',
      user: reviewer,
      json: { event: 'mark_ready' },
    });

    const res = await appFetch(`/applications/${appId}/transitions`, {
      method: 'POST',
      user: reviewer,
      json: { event: 'approve' },
    });
    expect(res.status).toBe(403);
  });

  it('approver completes the workflow', async () => {
    const res = await appFetch(`/applications/${appId}/transitions`, {
      method: 'POST',
      user: approver,
      json: { event: 'approve' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('APPROVED');
  });
});

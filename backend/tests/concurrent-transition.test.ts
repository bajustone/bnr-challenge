/**
 * "Two users attempt to act on the same application simultaneously."
 *
 * The brief calls this out explicitly. The proof:
 *   - exactly one Promise.all branch returns 200 (the winner)
 *   - the other returns 409 (ConcurrentUpdateError)
 *   - exactly one audit row exists for the resulting transition
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { and, eq } from 'drizzle-orm';

import { db } from '../src/db/index.ts';
import { auditLog } from '../src/db/schema.ts';
import { appFetch, createTestUser, type TestUser } from './helpers/auth.ts';

let admin: TestUser;
let applicant: TestUser;
let reviewer: TestUser;
let appId: string;

beforeAll(async () => {
  admin = await createTestUser({ label: 'concur-admin', roles: ['admin'] });
  applicant = await createTestUser({
    label: 'concur-applicant',
    roles: ['applicant'],
    grantedBy: admin.id,
  });
  reviewer = await createTestUser({
    label: 'concur-reviewer',
    roles: ['reviewer'],
    grantedBy: admin.id,
  });

  const create = await appFetch('/applications', {
    method: 'POST',
    user: applicant,
    json: { institutionName: 'Concurrent Bank', institutionType: 'commercial_bank' },
  });
  expect(create.status).toBe(201);
  appId = ((await create.json()) as { id: string }).id;

  await appFetch(`/applications/${appId}/transitions`, {
    method: 'POST',
    user: applicant,
    json: { event: 'submit' },
  });
  await appFetch(`/applications/${appId}/transitions`, {
    method: 'POST',
    user: reviewer,
    json: { event: 'assign' },
  });
});

describe('two simultaneous mark_ready requests', () => {
  it('exactly one wins (200), the other loses (409), audit logs exactly one transition', async () => {
    const fire = () =>
      appFetch(`/applications/${appId}/transitions`, {
        method: 'POST',
        user: reviewer,
        json: { event: 'mark_ready' },
      });

    const [a, b] = await Promise.all([fire(), fire()]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.resourceType, 'application'),
          eq(auditLog.resourceId, appId),
          eq(auditLog.action, 'application.mark_ready'),
        ),
      );
    expect(auditRows.length).toBe(1);
  });
});

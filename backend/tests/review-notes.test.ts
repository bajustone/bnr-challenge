/**
 * Review notes:
 *   - staff post + read both visibilities
 *   - applicant sees only `visibility = "applicant"`
 *   - applicant gets 403 on POST
 *   - request_info without a message returns 422 (state-machine guard)
 *   - app_user grant denies UPDATE / DELETE on review_notes (engine-level)
 */

import { beforeAll, describe, expect, it } from 'vitest';

import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

import { appFetch, createTestUser, type TestUser } from './helpers/auth.ts';

let admin: TestUser;
let applicant: TestUser;
let reviewer: TestUser;
let appId: string;

beforeAll(async () => {
  admin = await createTestUser({ label: 'rn-admin', roles: ['admin'] });
  applicant = await createTestUser({
    label: 'rn-applicant',
    roles: ['applicant'],
    grantedBy: admin.id,
  });
  reviewer = await createTestUser({
    label: 'rn-reviewer',
    roles: ['reviewer'],
    grantedBy: admin.id,
  });

  const create = await appFetch('/applications', {
    method: 'POST',
    user: applicant,
    json: { institutionName: 'Notes Bank', institutionType: 'commercial_bank' },
  });
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

describe('review-notes visibility', () => {
  it('staff can post both visibilities, applicant only sees their own', async () => {
    const staffNote = await appFetch(`/applications/${appId}/notes`, {
      method: 'POST',
      user: reviewer,
      json: { visibility: 'staff', body: 'internal note: spotty FX exposure' },
    });
    expect(staffNote.status).toBe(201);

    const applicantNote = await appFetch(`/applications/${appId}/notes`, {
      method: 'POST',
      user: reviewer,
      json: { visibility: 'applicant', body: 'please clarify' },
    });
    expect(applicantNote.status).toBe(201);

    const staffView = await appFetch(`/applications/${appId}/notes`, { user: reviewer });
    expect(staffView.status).toBe(200);
    const allNotes = (await staffView.json()) as Array<{ visibility: string }>;
    expect(allNotes.length).toBe(2);

    const ownerView = await appFetch(`/applications/${appId}/notes`, { user: applicant });
    expect(ownerView.status).toBe(200);
    const ownerNotes = (await ownerView.json()) as Array<{ visibility: string }>;
    expect(ownerNotes.length).toBe(1);
    expect(ownerNotes[0]!.visibility).toBe('applicant');
  });

  it('applicant cannot POST a note (403)', async () => {
    const res = await appFetch(`/applications/${appId}/notes`, {
      method: 'POST',
      user: applicant,
      json: { visibility: 'applicant', body: 'i should not be allowed' },
    });
    expect(res.status).toBe(403);
  });

  it('request_info without a message returns 422', async () => {
    const res = await appFetch(`/applications/${appId}/transitions`, {
      method: 'POST',
      user: reviewer,
      json: { event: 'request_info' },
    });
    expect(res.status).toBe(422);
  });

  it('request_info with a message creates an applicant-visible note in the same tx', async () => {
    const before = (await (
      await appFetch(`/applications/${appId}/notes`, { user: reviewer })
    ).json()) as unknown[];
    const res = await appFetch(`/applications/${appId}/transitions`, {
      method: 'POST',
      user: reviewer,
      json: {
        event: 'request_info',
        message: 'need Q3 capital adequacy ratios before resuming review',
      },
    });
    expect(res.status).toBe(200);
    const status = ((await res.json()) as { status: string }).status;
    expect(status).toBe('RFI_REQUESTED');

    const after = (await (
      await appFetch(`/applications/${appId}/notes`, { user: reviewer })
    ).json()) as Array<{ visibility: string; body: string }>;
    expect(after.length).toBe(before.length + 1);
    const newNote = after[after.length - 1]!;
    expect(newNote.visibility).toBe('applicant');
    expect(newNote.body).toMatch(/Q3 capital adequacy/);
  });
});

describe('engine-level append-only grant', () => {
  it('app_user has SELECT/INSERT but no UPDATE/DELETE on review_notes', async () => {
    const dbUrl = process.env.DATABASE_URL!;
    // We can't log in as `app_user` (no LOGIN flag) but we can probe the
    // grant table — definitive even without a live connection.
    const probe = postgres(dbUrl, { max: 1, onnotice: () => {} });
    const probeDb = drizzle(probe);
    const rows = (await probeDb.execute(
      sql`SELECT privilege_type FROM information_schema.role_table_grants
              WHERE table_name = 'review_notes' AND grantee = 'app_user'`,
    )) as unknown as Array<{ privilege_type: string }>;
    const privs = new Set(rows.map((r) => r.privilege_type));
    expect(privs.has('SELECT')).toBe(true);
    expect(privs.has('INSERT')).toBe(true);
    expect(privs.has('UPDATE')).toBe(false);
    expect(privs.has('DELETE')).toBe(false);
    await probe.end({ timeout: 5 });
  });
});

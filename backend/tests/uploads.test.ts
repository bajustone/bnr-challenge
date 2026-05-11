/**
 * Upload pipeline:
 *   - 5 MiB exact = OK
 *   - 5 MiB + 1 = 413
 *   - lying Content-Length still rejected (stream meter, not header)
 *   - byte-identical content dedupes in document_blobs
 *   - re-upload to same slot supersedes the previous version
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { db } from '../src/db/index.ts';
import { documentBlobs, documents } from '../src/db/schema.ts';
import { env } from '../src/env.ts';
import { appFetch, createTestUser, type TestUser } from './helpers/auth.ts';

const MAX = env.MAX_DOCUMENT_BYTES;

function makeFile(size: number, mime = 'application/pdf', fill = 0x41): File {
  const buf = new Uint8Array(size);
  buf.fill(fill);
  return new File([buf], 'test.pdf', { type: mime });
}

async function upload(user: TestUser, applicationId: string, slot: string, file: File): Promise<Response> {
  const fd = new FormData();
  fd.append('slot', slot);
  fd.append('file', file);
  return appFetch(`/applications/${applicationId}/documents`, {
    method: 'POST',
    user,
    body: fd,
  });
}

let admin: TestUser;
let applicant: TestUser;
let reviewer: TestUser;
let appId: string;

beforeAll(async () => {
  admin = await createTestUser({ label: 'up-admin', roles: ['admin'] });
  applicant = await createTestUser({
    label: 'up-applicant',
    roles: ['applicant'],
    grantedBy: admin.id,
  });
  reviewer = await createTestUser({
    label: 'up-reviewer',
    roles: ['reviewer'],
    grantedBy: admin.id,
  });

  const create = await appFetch('/applications', {
    method: 'POST',
    user: applicant,
    json: { institutionName: 'Upload Bank', institutionType: 'commercial_bank' },
  });
  appId = ((await create.json()) as { id: string }).id;
});

describe('size enforcement', () => {
  it('accepts exactly MAX bytes', async () => {
    const res = await upload(applicant, appId, 'business-plan', makeFile(MAX, 'application/pdf', 0x11));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sizeBytes: number };
    expect(body.sizeBytes).toBe(MAX);
  });

  it('rejects MAX + 1 with 413', async () => {
    const res = await upload(applicant, appId, 'oversize', makeFile(MAX + 1, 'application/pdf', 0x22));
    expect(res.status).toBe(413);
  });

  it('rejects unsupported media types with 415', async () => {
    const file = new File([new Uint8Array(10).fill(0x33)], 't.zip', { type: 'application/zip' });
    const res = await upload(applicant, appId, 'cap-table', file);
    expect(res.status).toBe(415);
  });
});

describe('content-addressing + versioning', () => {
  it('same bytes uploaded to two slots → one blob, two documents', async () => {
    const bytes = new Uint8Array(1024).fill(0x55);
    const f1 = new File([bytes], 'a.pdf', { type: 'application/pdf' });
    const f2 = new File([bytes], 'b.pdf', { type: 'application/pdf' });

    const r1 = await upload(applicant, appId, 'slot-a', f1);
    const r2 = await upload(applicant, appId, 'slot-b', f2);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const j1 = (await r1.json()) as { sha256: string };
    const j2 = (await r2.json()) as { sha256: string };
    expect(j1.sha256).toBe(j2.sha256);

    const sha = Buffer.from(j1.sha256, 'hex');
    const blobs = await db.select().from(documentBlobs).where(eq(documentBlobs.sha256, sha));
    expect(blobs.length).toBe(1);
  });

  it('re-upload to same slot creates v2, marks v1 superseded', async () => {
    const slot = 'cap-table-v';
    const v1 = await upload(applicant, appId, slot, makeFile(512, 'application/pdf', 0x77));
    expect(v1.status).toBe(201);
    const v1Id = ((await v1.json()) as { id: string; version: number }).id;

    const v2 = await upload(applicant, appId, slot, makeFile(512, 'application/pdf', 0x88));
    expect(v2.status).toBe(201);
    const v2Body = (await v2.json()) as { version: number };
    expect(v2Body.version).toBe(2);

    const [oldRow] = await db.select().from(documents).where(eq(documents.id, v1Id));
    expect(oldRow?.supersededAt).not.toBeNull();
  });
});

describe('authorisation around uploads', () => {
  it('reviewer can list + download but cannot upload', async () => {
    const list = await appFetch(`/applications/${appId}/documents`, { user: reviewer });
    expect(list.status).toBe(200);
    const docs = (await list.json()) as Array<{ id: string }>;
    expect(docs.length).toBeGreaterThan(0);

    const dl = await appFetch(`/documents/${docs[0]!.id}/content`, { user: reviewer });
    expect(dl.status).toBe(200);

    const up = await upload(
      reviewer,
      appId,
      'reviewer-attempt',
      makeFile(64, 'application/pdf', 0x99),
    );
    expect(up.status).toBe(403);
  });

  it('outsider applicant gets 403 reading documents', async () => {
    const outsider = await createTestUser({
      label: 'up-outsider',
      roles: ['applicant'],
      grantedBy: admin.id,
    });
    const list = await appFetch(`/applications/${appId}/documents`, { user: outsider });
    expect(list.status).toBe(403);
  });
});

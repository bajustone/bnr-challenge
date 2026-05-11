/**
 * Audit chain: walks clean → `ok`; tamper with one row's after_state
 * (drop the append-only trigger for the duration) → verifier returns the
 * right `firstBadId`; revert restores the chain.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';

import { db } from '../src/db/index.ts';
import { auditLog } from '../src/db/schema.ts';
import { verifyChain } from '../src/services/admin.service.ts';
import { appFetch, createTestUser, type TestUser } from './helpers/auth.ts';

let admin: TestUser;
let applicant: TestUser;

beforeAll(async () => {
  admin = await createTestUser({ label: 'chain-admin', roles: ['admin'] });
  applicant = await createTestUser({
    label: 'chain-applicant',
    roles: ['applicant'],
    grantedBy: admin.id,
  });

  // Produce a few events so the chain has length.
  const create = await appFetch('/applications', {
    method: 'POST',
    user: applicant,
    json: { institutionName: 'Chain Bank', institutionType: 'commercial_bank' },
  });
  const appId = ((await create.json()) as { id: string }).id;
  await appFetch(`/applications/${appId}/transitions`, {
    method: 'POST',
    user: applicant,
    json: { event: 'submit' },
  });
});

afterAll(async () => {
  // If we left the trigger off, put it back.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION audit_log_no_mutate()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_log is append-only'
        USING ERRCODE = 'insufficient_privilege';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
    CREATE TRIGGER trg_audit_no_update
      BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_mutate();
  `);
});

describe('audit chain verifier', () => {
  it('verifies a clean chain as ok', async () => {
    const result = await verifyChain({ id: admin.id, roles: ['admin'] });
    expect(result.ok).toBe(true);
    expect(result.firstBadId).toBeNull();
    expect(result.rowsChecked).toBeGreaterThan(0);
  });

  it('flags the tampered row when after_state is mutated', async () => {
    // The append-only trigger blocks UPDATE even for the superuser, so drop
    // it for the duration of this test, mutate, assert, restore.
    await db.execute(sql`DROP TRIGGER trg_audit_no_update ON audit_log`);
    try {
      const [target] = await db.select().from(auditLog).orderBy(auditLog.id).limit(1);
      expect(target).toBeDefined();
      const originalAfter = target!.afterState;

      await db.execute(sql`
        UPDATE audit_log
           SET after_state = jsonb_set(coalesce(after_state, '{}'::jsonb), '{tampered}', 'true'::jsonb)
         WHERE id = ${target!.id}
      `);

      const result = await verifyChain({ id: admin.id, roles: ['admin'] });
      expect(result.ok).toBe(false);
      expect(result.firstBadId).toBe(target!.id.toString());

      // Revert so later tests see a clean chain. JSON.stringify + cast
      // because the driver can't bind a plain object as a jsonb parameter.
      const originalAfterJson = JSON.stringify(originalAfter);
      await db.execute(sql`
        UPDATE audit_log SET after_state = ${originalAfterJson}::jsonb WHERE id = ${target!.id}
      `);
      const restored = await verifyChain({ id: admin.id, roles: ['admin'] });
      expect(restored.ok).toBe(true);
    } finally {
      // afterAll also recreates, but doing it here lets the next test in this
      // file see the trigger back.
      await db.execute(sql`
        CREATE TRIGGER trg_audit_no_update
          BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
          FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_mutate();
      `);
    }
  });
});

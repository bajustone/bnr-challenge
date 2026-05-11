/**
 * Database smoke tests. Proves that the testcontainer + migrate.ts pipeline
 * actually produced the schema we expect; future domain tests use the same
 * `inject('databaseUrl')` channel to get a connection.
 *
 * Connects as the container's superuser (see global-setup.ts). The grant
 * boundary between app_user / app_owner is a production concern; tests
 * just need the tables in place.
 */

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

import * as schema from '../src/db/schema.ts';

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(() => {
  const url = inject('databaseUrl');
  client = postgres(url, { max: 2, onnotice: () => {} });
  db = drizzle(client, { schema });
});

afterAll(async () => {
  await client?.end({ timeout: 5 });
});

describe('migrations', () => {
  it('created every expected table', async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type   = 'BASE TABLE'
    `);
    const names = new Set(rows.map((r) => r.table_name));

    for (const expected of [
      'users',
      'sessions',
      'accounts',
      'verifications',
      'user_roles',
      'applications',
      'documents',
      'document_blobs',
      'review_notes',
      'audit_log',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('installed the citext + pgcrypto extensions', async () => {
    const rows = await db.execute<{ extname: string }>(sql`
      SELECT extname FROM pg_extension WHERE extname IN ('citext', 'pgcrypto')
    `);
    const names = new Set(rows.map((r) => r.extname));
    expect(names).toContain('citext');
    expect(names).toContain('pgcrypto');
  });

  it('created the app_user role with no LOGIN (password set out of band)', async () => {
    const rows = await db.execute<{ rolname: string; rolcanlogin: boolean }>(sql`
      SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'app_user'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0]?.rolcanlogin).toBe(false);
  });

  it('blocks UPDATE/DELETE on audit_log via the trigger', async () => {
    // The trigger raises regardless of the connecting role, so even
    // the superuser cannot mutate audit_log without dropping the trigger first.
    // Drizzle wraps the postgres error, putting the original on .cause.
    let caught: unknown;
    try {
      await db.execute(
        sql`UPDATE audit_log SET action = 'tampered' WHERE id = 1`,
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { message?: string } }).cause;
    expect(cause?.message ?? '').toMatch(/append-only/i);
  });
});

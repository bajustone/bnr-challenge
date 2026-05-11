/**
 * Migration runner. Three phases under the owner connection:
 *   1. pre/    — SQL that must run before drizzle DDL (extensions).
 *   2. drizzle — generated migrations under ./migrations/*.sql.
 *   3. post/   — roles, grants, triggers. Re-applied every run so new
 *                tables inherit grants.
 *
 * Re-running on an up-to-date DB is a no-op.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate as drizzleMigrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { env } from '../env.ts';
import { logger } from '../logger.ts';

const log = logger.child({ component: 'migrate' });

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '..', '..', 'migrations');
const PRE_DIR = path.join(MIGRATIONS_DIR, 'sql', 'pre');
const POST_DIR = path.join(MIGRATIONS_DIR, 'sql', 'post');

async function listSql(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function applyDir(client: postgres.Sql, dir: string, label: string): Promise<void> {
  const files = await listSql(dir);
  if (files.length === 0) {
    log.info({ phase: label }, 'no files');
    return;
  }
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    log.info({ phase: label, file }, 'applying');
    await client.unsafe(sql);
  }
}

async function main(): Promise<void> {
  const ownerUrl = env.DATABASE_OWNER_URL;
  if (!ownerUrl) {
    log.fatal('DATABASE_OWNER_URL is required to run migrations.');
    process.exit(1);
  }

  // max: 1 so pre/drizzle/post share session settings.
  const client = postgres(ownerUrl, { max: 1, onnotice: () => {} });

  try {
    log.info({ phase: 'pre' }, 'pre-DDL');
    await applyDir(client, PRE_DIR, 'pre');
    log.info({ phase: 'drizzle' }, 'drizzle migrations');
    await drizzleMigrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
    log.info({ phase: 'post' }, 'post-DDL');
    await applyDir(client, POST_DIR, 'post');
    log.info('migrations complete');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  log.fatal({ err }, 'migration failed');
  process.exit(1);
});

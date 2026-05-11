/**
 * One Postgres testcontainer for the whole suite: starts the image, runs
 * migrate.ts as the superuser, exposes the URL via `inject('databaseUrl')`
 * and process.env so tests can import modules that read env at load time.
 * Tests connect as the container's superuser — the app_user grant boundary
 * is a production concern.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

const BACKEND_DIR = path.resolve(fileURLToPath(import.meta.url), '..', '..');

let container: StartedPostgreSqlContainer | undefined;

export default async function setup({ provide }: TestProject) {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('bnr_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const url = container.getConnectionUri();

  // Spawn under Bun so migrate.ts's .ts imports resolve.
  const result = spawnSync('bun', ['run', 'src/db/migrate.ts'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: url,
      DATABASE_OWNER_URL: url,
      NODE_ENV: 'test',
    },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    await container.stop();
    throw new Error(`migrations failed (exit ${result.status})`);
  }

  provide('databaseUrl', url);

  // Workers inherit env (pool: 'forks', singleFork: true) — set before any
  // test file imports env.ts / db/index.ts.
  process.env.DATABASE_URL = url;
  process.env.DATABASE_OWNER_URL = url;
  process.env.NODE_ENV = 'test';
  if (!process.env.LOG_LEVEL && process.env.BNR_DEBUG_TESTS === '1') {
    process.env.LOG_LEVEL = 'debug';
  }
  process.env.AUDIT_HASH_SECRET = 'test-audit-secret-not-for-production';
  process.env.STORAGE_DIR =
    process.env.STORAGE_DIR ?? mkdtempSync(path.join(os.tmpdir(), 'bnr-storage-'));

  return async () => {
    await container?.stop();
  };
}

// Type-safe `inject('databaseUrl')` in tests.
declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

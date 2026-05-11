/**
 * Global setup: one Postgres testcontainer for the whole suite.
 *
 *   - starts postgres:16-alpine
 *   - runs migrate.ts (pre/ → drizzle → post/) as the superuser
 *   - publishes the connection URL to tests via vitest's `inject()`
 *
 * The same URL is published for both DATABASE_URL and DATABASE_OWNER_URL.
 * Tests don't exercise the app_user / app_owner grant boundary — the
 * production-only grants in post/0002 still get applied, so any test that
 * connects as `app_user` would observe the real GRANT shape. Tests today
 * use the superuser URL for convenience.
 *
 * Container start + image pull on first run is slow; vitest.config.ts
 * raises hookTimeout to 120s to accommodate.
 */

import { spawnSync } from 'node:child_process';
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

  // Run migrations via Bun so the .ts extensions in migrate.ts resolve.
  // We pass the URL through env because env.ts reads process.env at import.
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

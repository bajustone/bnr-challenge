/**
 * Vitest config. One Postgres testcontainer for the whole run (see
 * tests/global-setup.ts) — spinning one per test would push the suite into
 * minutes for no test-isolation benefit beyond what transactions give us.
 *
 * Use `inject('databaseUrl')` inside a test to get the container URL.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Pulling postgres:16-alpine and running migrations on first run can be slow.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});

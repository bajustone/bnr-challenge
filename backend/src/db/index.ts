/**
 * Runtime DB client. Connects as app_user — no UPDATE/DELETE on audit_log.
 * Never import DATABASE_OWNER_URL here; that's reserved for migrate/seed.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../env.ts';
import { drizzleLogger } from '../logger.ts';
import * as schema from './schema.ts';

const client = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  onnotice: () => {},
});

// Drizzle queries log to pino at debug.
export const db = drizzle(client, { schema, logger: drizzleLogger });
export { schema };

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}

/**
 * Two database URLs: DATABASE_URL → app_user (runtime, no UPDATE/DELETE on
 * audit_log), DATABASE_OWNER_URL → app_owner (migrations/seeds, DDL).
 */

import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  DATABASE_OWNER_URL: z.string().url().optional(),
  /** Pepper for the audit-row hash. If lost, the chain becomes unverifiable. */
  AUDIT_HASH_SECRET: z.string().min(16).optional(),
  /** pino level. Omit → derived from NODE_ENV (prod=info, test=silent, else=debug). */
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .optional(),
  /** Mount point for uploaded document blobs. See implementation-plan §3. */
  STORAGE_DIR: z.string().min(1).default('./storage'),
  /** Hard ceiling on individual document size (bytes). 5 MiB per brief. */
  MAX_DOCUMENT_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  /** Comma-separated CORS origins permitted to send credentialed requests. */
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3001')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();

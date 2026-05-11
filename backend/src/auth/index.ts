/**
 * better-auth instance. Identity only — role and dual-control live in domain code.
 * Argon2id via Bun.password to match docs/architecture-thinking.html.
 */

import { randomUUID } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db, schema } from '../db/index.ts';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    password: {
      hash: (password) => Bun.password.hash(password, { algorithm: 'argon2id' }),
      verify: ({ hash, password }) => Bun.password.verify(password, hash),
    },
  },
  advanced: {
    database: {
      generateId: () => randomUUID(),
    },
  },
});

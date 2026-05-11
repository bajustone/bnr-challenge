/**
 * better-auth instance. Identity only — roles + dual-control live in domain code.
 * Bun runtime: argon2id via Bun.password. Node (vitest, CI): better-auth's default scrypt.
 * Users hashed under one runtime cannot verify under the other; in practice seed +
 * live login run under Bun and tests under Node, so the two never mix.
 */

import { randomUUID } from 'node:crypto';

import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db, schema } from '../db/index.ts';

declare const Bun: { password: { hash: (s: string, opts: { algorithm: string }) => Promise<string>; verify: (s: string, hash: string) => Promise<boolean> } } | undefined;
const hasBun = typeof Bun !== 'undefined' && typeof Bun.password?.hash === 'function';

const emailAndPassword: NonNullable<BetterAuthOptions['emailAndPassword']> = {
  enabled: true,
  autoSignIn: false,
  ...(hasBun
    ? {
        password: {
          hash: (password: string) => Bun!.password.hash(password, { algorithm: 'argon2id' }),
          verify: ({ hash, password }: { hash: string; password: string }) =>
            Bun!.password.verify(password, hash),
        },
      }
    : {}),
};

export const auth = betterAuth({
  basePath: '/auth',
  baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? '3001'}`,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword,
  advanced: {
    database: {
      generateId: () => randomUUID(),
    },
  },
});

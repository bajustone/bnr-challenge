/**
 * Users repository — identity-side reads only. Writes go through better-auth
 * so password hashing stays in one place.
 */

import { eq, isNull } from 'drizzle-orm';

import { users, type User } from '../db/schema.ts';
import type { DbOrTx } from './types.ts';

export function makeUsersRepo(h: DbOrTx) {
  return {
    async findById(id: string): Promise<User | undefined> {
      const [row] = await h.select().from(users).where(eq(users.id, id)).limit(1);
      return row;
    },

    async findByEmail(email: string): Promise<User | undefined> {
      const [row] = await h.select().from(users).where(eq(users.email, email)).limit(1);
      return row;
    },

    async listActive(): Promise<User[]> {
      return h.select().from(users).where(isNull(users.disabledAt));
    },
  };
}

export type UsersRepo = ReturnType<typeof makeUsersRepo>;

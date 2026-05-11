/**
 * user_roles is a join table without its own surrogate key; the PK is
 * (user_id, role). Grants and revokes are both audited at the service layer.
 */

import { and, eq } from 'drizzle-orm';

import { userRoles, type UserRole } from '../db/schema.ts';
import type { Role } from 'bnr-shared';
import type { DbOrTx } from './types.ts';

export function makeUserRolesRepo(h: DbOrTx) {
  return {
    async listForUser(userId: string): Promise<Role[]> {
      const rows = await h
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, userId));
      return rows.map((r) => r.role as Role);
    },

    async grant(input: { userId: string; role: Role; grantedBy: string }): Promise<UserRole> {
      const [row] = await h
        .insert(userRoles)
        .values({ userId: input.userId, role: input.role, grantedBy: input.grantedBy })
        .onConflictDoNothing({ target: [userRoles.userId, userRoles.role] })
        .returning();
      if (row) return row;
      // No-op insert (role already held) — fetch the existing row for caller convenience.
      const [existing] = await h
        .select()
        .from(userRoles)
        .where(and(eq(userRoles.userId, input.userId), eq(userRoles.role, input.role)))
        .limit(1);
      if (!existing) throw new Error('user_roles grant returned no row');
      return existing;
    },

    async revoke(input: { userId: string; role: Role }): Promise<boolean> {
      const result = await h
        .delete(userRoles)
        .where(and(eq(userRoles.userId, input.userId), eq(userRoles.role, input.role)))
        .returning({ userId: userRoles.userId });
      return result.length > 0;
    },
  };
}

export type UserRolesRepo = ReturnType<typeof makeUserRolesRepo>;

/** Chain: requestLogger → sessionMiddleware → requireAuth → loadRoles → requireRole(…) → validator. */

import type { MiddlewareHandler } from 'hono';

import type { Role } from 'bnr-shared';

import { auth } from './index.ts';
import { db } from '../db/index.ts';
import { ForbiddenError, UnauthorizedError } from '../errors.ts';
import { makeUserRolesRepo } from '../repositories/user-roles.repo.ts';

export type SessionShape = {
  user: { id: string; email: string; name: string };
  session: { id: string; userId: string; expiresAt: Date };
};

export type AuthVariables = {
  session: SessionShape | null;
  roles: Role[];
};

export const sessionMiddleware: MiddlewareHandler<{ Variables: AuthVariables }> = async (
  c,
  next,
) => {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set('session', (result as SessionShape | null) ?? null);
  await next();
};

export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  if (!c.var.session) throw new UnauthorizedError('authentication required');
  await next();
};

/** One indexed SELECT per request; handlers read `c.var.roles`. */
export const loadRoles: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  if (!c.var.session) throw new UnauthorizedError('authentication required');
  const repo = makeUserRolesRepo(db);
  const roles = await repo.listForUser(c.var.session.user.id);
  c.set('roles', roles);
  await next();
};

/** 403 unless the actor holds at least one of the listed roles. */
export const requireRole =
  (...allowed: Role[]): MiddlewareHandler<{ Variables: AuthVariables }> =>
  async (c, next) => {
    const roles = c.var.roles ?? [];
    const ok = roles.some((r) => allowed.includes(r));
    if (!ok) throw new ForbiddenError('role required', { allowed });
    await next();
  };

/** True if any of the actor's roles is in the staff set. */
export function hasStaffRole(roles: readonly Role[]): boolean {
  return roles.some((r) => r === 'reviewer' || r === 'approver' || r === 'admin');
}

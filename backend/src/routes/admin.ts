/**
 * Admin surface: users, role grants, audit query + chain verifier.
 * Every route is gated by requireRole('admin'); the services double-check.
 */

import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { sValidator as validator } from '@hono/standard-validator';
import { z } from 'zod';

import {
  loadRoles,
  requireAuth,
  requireRole,
  sessionMiddleware,
  type AuthVariables,
} from '../auth/middleware.ts';
import {
  grantRole,
  listUsers,
  revokeRole,
  verifyChain,
} from '../services/admin.service.ts';
import { makeAuditRepo } from '../repositories/audit.repo.ts';
import { db } from '../db/index.ts';
import { AuditRowSchema, RoleSchema, Uuid } from './schemas.ts';
import { serialiseAuditRow } from './serializers.ts';
import type { RequestLoggerVariables } from '../middleware/request-logger.ts';
import type * as adminSvc from '../services/admin.service.ts';

type Vars = AuthVariables & RequestLoggerVariables;

export const adminRoutes = new Hono<{ Variables: Vars }>();

adminRoutes.use('*', sessionMiddleware);
adminRoutes.use('*', requireAuth, loadRoles, requireRole('admin'));

function actor(c: { var: Vars }): adminSvc.Actor {
  return {
    id: c.var.session!.user.id,
    roles: c.var.roles ?? [],
    requestId: c.var.requestId,
  };
}

const UserWithRolesSchema = z
  .object({
    id: Uuid,
    email: z.string(),
    name: z.string(),
    roles: z.array(RoleSchema),
    disabledAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'UserWithRoles' });

const GrantRoleSchema = z.object({ role: RoleSchema });

const AuditQuerySchema = z.object({
  actorId: Uuid.optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const VerifyResponseSchema = z
  .object({
    ok: z.boolean(),
    lastVerifiedId: z.string().nullable(),
    firstBadId: z.string().nullable(),
    reason: z.string().optional(),
    rowsChecked: z.number().int().nonnegative(),
  })
  .meta({ id: 'AuditVerifyResponse' });

adminRoutes.get(
  '/users',
  describeRoute({
    summary: 'List users + their roles',
    tags: ['admin'],
    responses: {
      200: {
        description: 'List',
        content: {
          'application/json': {
            schema: resolver(z.array(UserWithRolesSchema)),
          },
        },
      },
    },
  }),
  async (c) => {
    const rows = await listUsers(actor(c));
    return c.json(
      rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        roles: u.roles,
        disabledAt: u.disabledAt ? u.disabledAt.toISOString() : null,
      })),
    );
  },
);

adminRoutes.post(
  '/users/:id/roles',
  describeRoute({
    summary: 'Grant a role to a user',
    tags: ['admin'],
    responses: { 204: { description: 'Granted' } },
  }),
  validator('json', GrantRoleSchema),
  async (c) => {
    await grantRole(actor(c), {
      userId: c.req.param('id'),
      role: c.req.valid('json').role,
    });
    return c.body(null, 204);
  },
);

adminRoutes.delete(
  '/users/:id/roles/:role',
  describeRoute({
    summary: 'Revoke a role from a user',
    tags: ['admin'],
    responses: {
      204: { description: 'Revoked' },
      404: { description: 'Role not held by user' },
    },
  }),
  async (c) => {
    await revokeRole(actor(c), {
      userId: c.req.param('id'),
      role: c.req.param('role') as Parameters<typeof revokeRole>[1]['role'],
    });
    return c.body(null, 204);
  },
);

adminRoutes.get(
  '/audit',
  describeRoute({
    summary: 'Query the audit log',
    tags: ['admin'],
    responses: {
      200: {
        description: 'Rows',
        content: {
          'application/json': { schema: resolver(z.array(AuditRowSchema)) },
        },
      },
    },
  }),
  validator('query', AuditQuerySchema),
  async (c) => {
    const rows = await makeAuditRepo(db).list(c.req.valid('query'));
    return c.json(rows.map(serialiseAuditRow));
  },
);

adminRoutes.get(
  '/audit/verify',
  describeRoute({
    summary: 'Walk the audit hash chain',
    description:
      'Recomputes prev_hash + row_hash for every row in id order. Returns the first bad row id on tamper.',
    tags: ['admin'],
    responses: {
      200: {
        description: 'Verify result',
        content: { 'application/json': { schema: resolver(VerifyResponseSchema) } },
      },
    },
  }),
  async (c) => {
    const result = await verifyChain(actor(c));
    return c.json(result);
  },
);

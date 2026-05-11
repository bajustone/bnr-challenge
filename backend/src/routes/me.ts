/**
 * /me — the UI's source of truth for "who am I, what can I do".
 */

import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';

import { MeResponseSchema } from './schemas.ts';
import {
  loadRoles,
  requireAuth,
  sessionMiddleware,
  type AuthVariables,
} from '../auth/middleware.ts';

export const meRoutes = new Hono<{ Variables: AuthVariables }>();

meRoutes.use('*', sessionMiddleware, requireAuth, loadRoles);

meRoutes.get(
  '/',
  describeRoute({
    summary: 'Current session',
    tags: ['auth'],
    responses: {
      200: {
        description: 'Identity + roles for the current session',
        content: { 'application/json': { schema: resolver(MeResponseSchema) } },
      },
      401: { description: 'No session' },
    },
  }),
  (c) => {
    const session = c.var.session!;
    return c.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
      roles: c.var.roles ?? [],
    });
  },
);

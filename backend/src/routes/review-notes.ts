/**
 * Review notes — staff posts, applicants read only their own visibility set.
 */

import { Hono } from 'hono';
import { sValidator as validator } from '@hono/standard-validator';
import { describeRoute, resolver } from 'hono-openapi';
import { z } from 'zod';

import {
  loadRoles,
  requireAuth,
  sessionMiddleware,
  type AuthVariables,
} from '../auth/middleware.ts';
import {
  create,
  listForApplication,
} from '../services/review-notes.service.ts';
import { CreateReviewNoteSchema, ReviewNoteSchema } from './schemas.ts';
import { serialiseReviewNote } from './serializers.ts';
import type { RequestLoggerVariables } from '../middleware/request-logger.ts';
import type * as svc from '../services/review-notes.service.ts';

type Vars = AuthVariables & RequestLoggerVariables;

export const reviewNotesRoutes = new Hono<{ Variables: Vars }>();

reviewNotesRoutes.use('*', sessionMiddleware);
reviewNotesRoutes.use('*', requireAuth, loadRoles);

function actor(c: { var: Vars }): svc.Actor {
  return {
    id: c.var.session!.user.id,
    roles: c.var.roles ?? [],
    requestId: c.var.requestId,
  };
}

reviewNotesRoutes.post(
  '/:id/notes',
  describeRoute({
    summary: 'Append a review note',
    description: 'Staff (reviewer / approver / admin) only. Append-only — no edit / delete.',
    tags: ['review-notes'],
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: resolver(ReviewNoteSchema) } },
      },
      403: { description: 'Staff role required' },
    },
  }),
  validator('json', CreateReviewNoteSchema),
  async (c) => {
    const body = c.req.valid('json');
    const note = await create(actor(c), {
      applicationId: c.req.param('id'),
      visibility: body.visibility,
      body: body.body,
    });
    return c.json(serialiseReviewNote(note), 201);
  },
);

reviewNotesRoutes.get(
  '/:id/notes',
  describeRoute({
    summary: 'List notes on an application',
    description:
      'Applicants see only `visibility = "applicant"`; staff see every note.',
    tags: ['review-notes'],
    responses: {
      200: {
        description: 'Notes oldest first',
        content: {
          'application/json': { schema: resolver(z.array(ReviewNoteSchema)) },
        },
      },
    },
  }),
  async (c) => {
    const notes = await listForApplication(actor(c), c.req.param('id'));
    return c.json(notes.map(serialiseReviewNote));
  },
);

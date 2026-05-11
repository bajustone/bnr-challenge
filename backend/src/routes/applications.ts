/**
 * Application endpoints. The transition endpoint is the single mutation
 * route for the state machine — every workflow event flows through it.
 */

import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { sValidator as validator } from '@hono/standard-validator';

import {
  ApplicationSchema,
  AuditRowSchema,
  CreateApplicationSchema,
  ListApplicationsQuerySchema,
  TransitionInputSchema,
  UpdateDraftSchema,
} from './schemas.ts';
import { z } from 'zod';
import {
  serialiseApplication,
  serialiseAuditRow,
} from './serializers.ts';
import {
  loadRoles,
  requireAuth,
  sessionMiddleware,
  type AuthVariables,
} from '../auth/middleware.ts';
import type { RequestLoggerVariables } from '../middleware/request-logger.ts';
import * as svc from '../services/applications.service.ts';

type Vars = AuthVariables & RequestLoggerVariables;

export const applicationsRoutes = new Hono<{ Variables: Vars }>();

applicationsRoutes.use('*', sessionMiddleware);
applicationsRoutes.use('*', requireAuth, loadRoles);

function actor(c: { var: Vars }): svc.Actor {
  return {
    id: c.var.session!.user.id,
    roles: c.var.roles ?? [],
    requestId: c.var.requestId,
  };
}

applicationsRoutes.post(
  '/',
  describeRoute({
    summary: 'Create a draft application',
    tags: ['applications'],
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: resolver(ApplicationSchema) } },
      },
    },
  }),
  validator('json', CreateApplicationSchema),
  async (c) => {
    const body = c.req.valid('json');
    const created = await svc.createDraft(actor(c), body);
    return c.json(serialiseApplication(created), 201);
  },
);

applicationsRoutes.get(
  '/',
  describeRoute({
    summary: 'List applications',
    description:
      'Applicants see only their own; reviewer / approver / admin see every application.',
    tags: ['applications'],
    responses: {
      200: {
        description: 'List',
        content: {
          'application/json': {
            schema: resolver(z.array(ApplicationSchema)),
          },
        },
      },
    },
  }),
  validator('query', ListApplicationsQuerySchema),
  async (c) => {
    const q = c.req.valid('query');
    const rows = await svc.list(actor(c), q);
    return c.json(rows.map(serialiseApplication));
  },
);

applicationsRoutes.get(
  '/:id',
  describeRoute({
    summary: 'Get application by id',
    tags: ['applications'],
    responses: {
      200: {
        description: 'Application',
        content: { 'application/json': { schema: resolver(ApplicationSchema) } },
      },
      403: { description: 'Not authorised to view' },
      404: { description: 'Not found' },
    },
  }),
  async (c) => {
    const row = await svc.getById(actor(c), c.req.param('id'));
    return c.json(serialiseApplication(row));
  },
);

applicationsRoutes.patch(
  '/:id',
  describeRoute({
    summary: 'Edit a DRAFT or RFI_REQUESTED application',
    tags: ['applications'],
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: resolver(ApplicationSchema) } },
      },
      403: { description: 'Not authorised' },
      404: { description: 'Not found' },
      409: { description: 'Concurrent update; refresh and retry' },
      422: { description: 'Application not editable in this status' },
    },
  }),
  validator('json', UpdateDraftSchema),
  async (c) => {
    const row = await svc.updateDraft(actor(c), c.req.param('id'), c.req.valid('json'));
    return c.json(serialiseApplication(row));
  },
);

applicationsRoutes.post(
  '/:id/transitions',
  describeRoute({
    summary: 'Apply a state-machine event',
    description:
      'Single mutation surface for workflow events: submit, assign, request_info, mark_ready, approve, reject, resubmit, withdraw.',
    tags: ['applications'],
    responses: {
      200: {
        description: 'Transitioned',
        content: { 'application/json': { schema: resolver(ApplicationSchema) } },
      },
      403: { description: 'Role / dual-control / owner check failed' },
      404: { description: 'Not found' },
      409: { description: 'Illegal transition or concurrent update' },
      422: { description: 'Missing required field (e.g. RFI message)' },
    },
  }),
  validator('json', TransitionInputSchema),
  async (c) => {
    const row = await svc.applyTransition(actor(c), c.req.param('id'), c.req.valid('json'));
    return c.json(serialiseApplication(row));
  },
);

applicationsRoutes.get(
  '/:id/history',
  describeRoute({
    summary: 'Audit history for an application',
    tags: ['applications'],
    responses: {
      200: {
        description: 'Audit rows, oldest first',
        content: {
          'application/json': { schema: resolver(z.array(AuditRowSchema)) },
        },
      },
      403: { description: 'Not authorised to view' },
      404: { description: 'Not found' },
    },
  }),
  async (c) => {
    const rows = await svc.history(actor(c), c.req.param('id'));
    return c.json(rows.map(serialiseAuditRow));
  },
);

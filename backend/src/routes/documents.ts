/**
 * Upload + download. Body-limit middleware is a cheap pre-check; the
 * service's stream meter is the authoritative defence against lying
 * Content-Length.
 */

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { describeRoute, resolver } from 'hono-openapi';
import { z } from 'zod';

import {
  loadRoles,
  requireAuth,
  sessionMiddleware,
  type AuthVariables,
} from '../auth/middleware.ts';
import { env } from '../env.ts';
import {
  ALLOWED_MIME_TYPES,
  getMetadata,
  listForApplication,
  openDownload,
  upload,
} from '../services/documents.service.ts';
import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../errors.ts';
import { DocumentSchema } from './schemas.ts';
import { serialiseDocument } from './serializers.ts';
import type { RequestLoggerVariables } from '../middleware/request-logger.ts';
import type * as docsSvc from '../services/documents.service.ts';

type Vars = AuthVariables & RequestLoggerVariables;

export const documentsRoutes = new Hono<{ Variables: Vars }>();
export const applicationDocumentsRoutes = new Hono<{ Variables: Vars }>();

documentsRoutes.use('*', sessionMiddleware);
documentsRoutes.use('*', requireAuth, loadRoles);
applicationDocumentsRoutes.use('*', sessionMiddleware);
applicationDocumentsRoutes.use('*', requireAuth, loadRoles);

function actor(c: { var: Vars }): docsSvc.Actor {
  return {
    id: c.var.session!.user.id,
    roles: c.var.roles ?? [],
    requestId: c.var.requestId,
  };
}

applicationDocumentsRoutes.post(
  '/:id/documents',
  bodyLimit({
    maxSize: env.MAX_DOCUMENT_BYTES + 64 * 1024, // headroom for multipart boundary
    onError: () => {
      throw new PayloadTooLargeError(env.MAX_DOCUMENT_BYTES);
    },
  }),
  describeRoute({
    summary: 'Upload a document version into a slot',
    description:
      'Multipart upload: fields `slot` (text) + `file` (binary). 5 MiB cap enforced three ways: middleware, stream meter, DB CHECK.',
    tags: ['documents'],
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['slot', 'file'],
            properties: {
              slot: { type: 'string', maxLength: 64 },
              file: { type: 'string', format: 'binary' },
            },
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Uploaded',
        content: { 'application/json': { schema: resolver(DocumentSchema) } },
      },
      413: { description: 'Too large' },
      415: { description: 'Unsupported media type' },
      422: { description: 'Bad slot / empty file / non-editable status' },
    },
  }),
  async (c) => {
    const form = await c.req.parseBody({ all: false });
    const slot = typeof form['slot'] === 'string' ? form['slot'] : '';
    const file = form['file'];
    if (!slot) throw new ValidationError('slot required');
    if (!(file instanceof File)) throw new ValidationError('file required');
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      throw new UnsupportedMediaTypeError(ALLOWED_MIME_TYPES);
    }

    const body = Readable.fromWeb(file.stream() as unknown as never) as Readable;
    const result = await upload(actor(c), {
      applicationId: c.req.param('id'),
      slot,
      filename: file.name,
      mimeType: file.type,
      body,
    });
    return c.json(serialiseDocument(result.document), 201);
  },
);

applicationDocumentsRoutes.get(
  '/:id/documents',
  describeRoute({
    summary: 'List documents on an application',
    tags: ['documents'],
    responses: {
      200: {
        description: 'List',
        content: {
          'application/json': { schema: resolver(z.array(DocumentSchema)) },
        },
      },
    },
  }),
  async (c) => {
    const scope = (c.req.query('include') ?? 'current') as 'current' | 'all';
    const rows = await listForApplication(actor(c), c.req.param('id'), scope);
    return c.json(rows.map(serialiseDocument));
  },
);

documentsRoutes.get(
  '/:id',
  describeRoute({
    summary: 'Document metadata',
    tags: ['documents'],
    responses: {
      200: {
        description: 'Metadata',
        content: { 'application/json': { schema: resolver(DocumentSchema) } },
      },
    },
  }),
  async (c) => {
    const doc = await getMetadata(actor(c), c.req.param('id'));
    return c.json(serialiseDocument(doc));
  },
);

documentsRoutes.get(
  '/:id/content',
  describeRoute({
    summary: 'Stream document bytes',
    tags: ['documents'],
    responses: {
      200: {
        description: 'Bytes',
        content: { 'application/octet-stream': {} },
      },
    },
  }),
  async (c) => {
    const handle = await openDownload(actor(c), c.req.param('id'));
    const nodeStream = createReadStream(handle.storagePath);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

    // RFC 5987-encoded filename so non-ASCII names survive the header.
    const safe = encodeURIComponent(handle.document.filename);
    c.header('Content-Type', handle.document.mimeType);
    c.header('Content-Length', String(handle.document.sizeBytes));
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${safe}`);
    return c.body(webStream);
  },
);

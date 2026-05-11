/**
 * Hono entrypoint. Chain: requestLogger → /auth/* (documented + catch-all)
 * → domain routers (each wires its own session + requireAuth) → onError.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import { describeRoute, openAPIRouteHandler, resolver } from 'hono-openapi';
import { z } from 'zod';

import { auth } from './auth/index.ts';
import { env } from './env.ts';
import { AppError } from './errors.ts';
import { logger } from './logger.ts';
import {
  requestLogger,
  type RequestLoggerVariables,
} from './middleware/request-logger.ts';
import { adminRoutes } from './routes/admin.ts';
import { applicationsRoutes } from './routes/applications.ts';
import { authRoutes } from './routes/auth.ts';
import {
  applicationDocumentsRoutes,
  documentsRoutes,
} from './routes/documents.ts';
import { meRoutes } from './routes/me.ts';
import { reviewNotesRoutes } from './routes/review-notes.ts';
import { ErrorBodySchema } from './routes/schemas.ts';
import { initStorage } from './storage/index.ts';

const RootResponse = z
  .object({ ok: z.literal(true), service: z.literal('bnr-backend') })
  .meta({ id: 'RootResponse' });

const HealthResponse = z
  .object({ status: z.literal('ok'), timestamp: z.iso.datetime() })
  .meta({ id: 'HealthResponse' });

type Vars = RequestLoggerVariables;

export const app = new Hono<{ Variables: Vars }>();

app.use('*', requestLogger);

// CORS: credentialed (cookie-bearing) requests from the configured origins.
// Frontend MUST send `credentials: 'include'` for the session cookie to ride.
app.use(
  '*',
  cors({
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    exposeHeaders: ['x-request-id'],
    maxAge: 600,
  }),
);

// Documented wrappers first — the more-specific routes take precedence,
// any other /auth/* path falls through to better-auth.
app.route('/auth', authRoutes);
app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw));

app.get(
  '/',
  describeRoute({
    summary: 'Service identity',
    tags: ['meta'],
    security: [],
    responses: {
      200: {
        description: 'Identity payload',
        content: { 'application/json': { schema: resolver(RootResponse) } },
      },
    },
  }),
  (c) => c.json({ ok: true as const, service: 'bnr-backend' as const }),
);

app.get(
  '/health',
  describeRoute({
    summary: 'Liveness',
    tags: ['meta'],
    security: [],
    responses: {
      200: {
        description: 'Live',
        content: { 'application/json': { schema: resolver(HealthResponse) } },
      },
    },
  }),
  (c) => c.json({ status: 'ok' as const, timestamp: new Date().toISOString() }),
);

app.route('/me', meRoutes);
app.route('/applications', applicationsRoutes);
app.route('/applications', applicationDocumentsRoutes);
app.route('/applications', reviewNotesRoutes);
app.route('/documents', documentsRoutes);
app.route('/admin', adminRoutes);

app.get(
  '/openapi.json',
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: 'BNR Licensing Portal API',
        version: '0.0.1',
        description:
          'Backend for the Bank Licensing & Compliance Portal. Spec generated from the Zod schemas the handlers actually use.',
      },
      tags: [
        { name: 'meta', description: 'Identity + health' },
        { name: 'auth', description: 'Sign-up / sign-in / sign-out / session' },
        { name: 'applications', description: 'Application workflow' },
        { name: 'documents', description: 'Document upload + download' },
        { name: 'review-notes', description: 'Reviewer commentary + RFI messages' },
        { name: 'admin', description: 'Role grants + audit verification' },
      ],
      components: {
        securitySchemes: {
          // Cookie set by POST /auth/sign-in/email; sent automatically by
          // browsers when fetch uses `credentials: 'include'`.
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'better-auth.session_token',
            description:
              'HttpOnly session cookie issued by /auth/sign-in/email. Sent automatically by the browser.',
          },
        },
      },
      // Default — every route requires the session cookie unless it sets
      // `security: []` to opt out (sign-up, sign-in, health, identity, docs).
      security: [{ cookieAuth: [] }],
      servers: [{ url: 'http://localhost:3001', description: 'Local dev' }],
    },
  }),
);

const DOCS_HTML = `<!doctype html>
<html>
  <head>
    <title>BNR Licensing Portal API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

app.get('/docs', (c) => c.html(DOCS_HTML));

app.onError((err, c) => {
  const requestId = c.var.requestId;
  const log = c.var.log ?? logger;

  if (err instanceof AppError) {
    if (err.status >= 500) log.error({ err, status: err.status }, 'app error 5xx');
    else log.warn({ status: err.status, code: err.code }, 'app error');
    return c.json(err.toBody(requestId), err.status);
  }

  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path, message: i.message }));
    log.warn({ issues }, 'validation error');
    return c.json(
      { error: 'invalid', requestId, issues } satisfies z.infer<typeof ErrorBodySchema>,
      422,
    );
  }

  // hono/standard-validator throws an HTTPException-ish object.
  const anyErr = err as { status?: number; message?: string; cause?: unknown };
  if (typeof anyErr.status === 'number' && anyErr.status >= 400 && anyErr.status < 500) {
    log.warn({ status: anyErr.status, message: anyErr.message }, 'http error');
    return c.json(
      { error: 'invalid', requestId, message: anyErr.message } as Record<string, unknown>,
      anyErr.status as 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422,
    );
  }

  log.error({ err }, 'unhandled error');
  return c.json({ error: 'internal', requestId }, 500);
});

const port = env.PORT;

export default {
  port,
  fetch: app.fetch,
};

if (import.meta.main) {
  await initStorage();
  logger.info(
    { port, url: `http://localhost:${port}`, storage: env.STORAGE_DIR },
    'bnr-backend listening',
  );
}

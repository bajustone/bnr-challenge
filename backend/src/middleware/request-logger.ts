/**
 * Per-request middleware: mint or honour a request id, attach a child
 * logger, emit one structured line per completed request. The id is
 * echoed as `x-request-id` so a user can quote it in a bug report.
 */

import { randomUUID } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import { logger, type Logger } from '../logger.ts';

export type RequestLoggerVariables = {
  requestId: string;
  log: Logger;
};

const HEADER = 'x-request-id';

export const requestLogger: MiddlewareHandler<{
  Variables: RequestLoggerVariables;
}> = async (c, next) => {
  // Honour upstream x-request-id (proxy chain) so traces span the whole hop.
  const requestId = c.req.header(HEADER) || randomUUID();
  const log = logger.child({
    requestId,
    method: c.req.method,
    path: c.req.path,
  });

  c.set('requestId', requestId);
  c.set('log', log);
  c.header(HEADER, requestId);

  const start = performance.now();
  try {
    await next();
    const durationMs = Number((performance.now() - start).toFixed(2));
    const status = c.res.status;
    // 5xx → error, 4xx → warn, else info. Keeps dashboards useful without filters.
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    log[level]({ status, durationMs }, 'request');
  } catch (err) {
    const durationMs = Number((performance.now() - start).toFixed(2));
    log.error({ err, durationMs }, 'request failed');
    throw err;
  }
};

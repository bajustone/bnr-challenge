import { Hono } from "hono";
import { describeRoute, openAPIRouteHandler, resolver } from "hono-openapi";
import { z } from "zod";

import { logger } from "./logger.ts";
import {
  requestLogger,
  type RequestLoggerVariables,
} from "./middleware/request-logger.ts";

// Handlers return what these schemas describe; the same schemas feed the
// OpenAPI spec via `resolver()`. One source of truth, no drift possible.

const RootResponse = z
  .object({
    ok: z.literal(true),
    service: z.literal("bnr-backend"),
  })
  .meta({
    id: "RootResponse",
    description: "Service identity payload.",
  });

const HealthResponse = z
  .object({
    status: z.literal("ok"),
    timestamp: z.iso.datetime().meta({
      description: "Server clock at the moment of the response (RFC 3339).",
    }),
  })
  .meta({
    id: "HealthResponse",
    description: "Liveness probe. Does not touch the database.",
  });

export const app = new Hono<{ Variables: RequestLoggerVariables }>();

// First in the chain so c.var.log is available to every subsequent handler.
app.use("*", requestLogger);

app.get(
  "/",
  describeRoute({
    summary: "Service identity",
    description:
      'Returns the service name. Used by upstream load balancers as a cheap "are you the right service" check.',
    tags: ["meta"],
    responses: {
      200: {
        description: "Identity payload.",
        content: {
          "application/json": { schema: resolver(RootResponse) },
        },
      },
    },
  }),
  (c) => c.json({ ok: true as const, service: "bnr-backend" as const }),
);

app.get(
  "/health",
  describeRoute({
    summary: "Liveness check",
    description:
      "Returns 200 if the process is running. Deliberately does not check the database — DB checks belong on a separate readiness endpoint so a transient DB blip does not get the process killed by an orchestrator.",
    tags: ["meta"],
    responses: {
      200: {
        description: "Process is live.",
        content: {
          "application/json": { schema: resolver(HealthResponse) },
        },
      },
    },
  }),
  (c) =>
    c.json({
      status: "ok" as const,
      timestamp: new Date().toISOString(),
    }),
);

app.get(
  "/openapi.json",
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: "BNR Licensing Portal API",
        version: "0.0.1",
        description:
          "Backend for the Bank Licensing & Compliance Portal. Spec is generated from the same Zod schemas the handlers use, so drift is impossible at the response-shape level.",
      },
      tags: [
        { name: "meta", description: "Service identity and health probes." },
      ],
      servers: [{ url: "http://localhost:3001", description: "Local dev" }],
    },
  }),
);

// Scalar via CDN avoids the @scalar/hono-api-reference adapter — same UI,
// one fewer dep, no version coupling.
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

app.get("/docs", (c) => c.html(DOCS_HTML));

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
};

if (import.meta.main) {
  logger.info(
    { port, url: `http://localhost:${port}` },
    "bnr-backend listening",
  );
}

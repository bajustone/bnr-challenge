/**
 * Smoke tests for the public routes and the OpenAPI surface.
 *
 * Hits the Hono app directly via `app.fetch(new Request(…))` — no listening
 * socket, no port collisions in CI. No database is touched, so this file
 * runs without the testcontainer being healthy (though globalSetup still
 * starts it for the rest of the suite).
 */

import { describe, it, expect } from 'vitest';

import { app } from '../src/index.ts';

async function request(path: string): Promise<Response> {
  return await app.fetch(new Request(`http://localhost${path}`));
}

describe('GET /', () => {
  it('returns the service identity payload', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'bnr-backend' });
  });
});

describe('GET /health', () => {
  it('returns status ok with an ISO timestamp', async () => {
    const res = await request('/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    // RFC 3339 round-trips through Date without losing the value.
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});

describe('GET /openapi.json', () => {
  it('serves a valid OpenAPI document covering / and /health', async () => {
    const res = await request('/openapi.json');
    expect(res.status).toBe(200);

    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, Record<string, unknown>>;
    };

    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('BNR Licensing Portal API');
    expect(spec.info.version).toBe('0.0.1');

    // Both endpoints are present and described.
    expect(spec.paths['/']).toBeDefined();
    expect(spec.paths['/']?.get).toBeDefined();
    expect(spec.paths['/health']).toBeDefined();
    expect(spec.paths['/health']?.get).toBeDefined();
  });
});

describe('GET /docs', () => {
  it('serves the Scalar API reference UI', async () => {
    const res = await request('/docs');
    expect(res.status).toBe(200);
    const body = await res.text();
    // The Scalar handler returns an HTML shell that boots the reference UI.
    expect(body.toLowerCase()).toContain('<!doctype html');
  });
});

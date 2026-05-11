/**
 * CORS preflight + actual-request headers for the frontend.
 * Default ALLOWED_ORIGINS includes http://localhost:5173.
 */

import { describe, expect, it } from 'vitest';

import { appFetch } from './helpers/auth.ts';

const SVELTE_DEV = 'http://localhost:5173';
const RANDOM = 'http://evil.example';

describe('CORS', () => {
  it('preflight from an allowed origin returns the right headers', async () => {
    const res = await appFetch('/me', {
      method: 'OPTIONS',
      headers: {
        origin: SVELTE_DEV,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(SVELTE_DEV);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('actual request from an allowed origin echoes the origin', async () => {
    const res = await appFetch('/health', { headers: { origin: SVELTE_DEV } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(SVELTE_DEV);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('unlisted origin gets no allow-origin header', async () => {
    const res = await appFetch('/health', { headers: { origin: RANDOM } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

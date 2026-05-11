/**
 * Documented `/auth/*` endpoints — sign-up → sign-in → /me → sign-out.
 * Proves the wrappers in `routes/auth.ts` forward to better-auth correctly
 * and that the cookie set on sign-in actually authenticates downstream.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { appFetch } from './helpers/auth.ts';

function uniqEmail() {
  return `routes-auth-${randomUUID()}@bnr.test`;
}

describe('GET /openapi.json', () => {
  it('documents the explicit auth endpoints + cookie security scheme', async () => {
    const res = await appFetch('/openapi.json');
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
      components?: { securitySchemes?: Record<string, { type?: string; in?: string }> };
      security?: unknown[];
    };
    expect(spec.paths['/auth/sign-up/email']?.post).toBeDefined();
    expect(spec.paths['/auth/sign-in/email']?.post).toBeDefined();
    expect(spec.paths['/auth/sign-out']?.post).toBeDefined();
    expect(spec.paths['/auth/get-session']?.get).toBeDefined();

    // Security scheme declared and applied globally.
    expect(spec.components?.securitySchemes?.cookieAuth?.type).toBe('apiKey');
    expect(spec.components?.securitySchemes?.cookieAuth?.in).toBe('cookie');
    expect(spec.security).toEqual([{ cookieAuth: [] }]);

    // Public endpoints opt out via `security: []`.
    expect(spec.paths['/auth/sign-in/email']?.post?.security).toEqual([]);
    expect(spec.paths['/health']?.get?.security).toEqual([]);
  });
});

describe('end-to-end sign-up → sign-in → /me → sign-out', () => {
  it('round-trips identity through cookies', async () => {
    const email = uniqEmail();

    const signUp = await appFetch('/auth/sign-up/email', {
      method: 'POST',
      json: { name: 'Route Test', email, password: 'route-test-pass' },
    });
    expect(signUp.status).toBe(200);

    const signIn = await appFetch('/auth/sign-in/email', {
      method: 'POST',
      json: { email, password: 'route-test-pass' },
    });
    expect(signIn.status).toBe(200);
    const setCookie = signIn.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const cookie = setCookie!.split(';')[0]!;

    const me = await appFetch('/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: { email: string }; roles: string[] };
    expect(meBody.user.email.toLowerCase()).toBe(email.toLowerCase());
    // Self sign-up auto-grants the `applicant` role; staff roles need an admin.
    expect(meBody.roles).toEqual(['applicant']);

    const signOut = await appFetch('/auth/sign-out', { method: 'POST', headers: { cookie } });
    expect(signOut.status).toBe(200);

    // After sign-out the same cookie no longer authorises /me.
    const after = await appFetch('/me', { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  it('rejects bad credentials with 401', async () => {
    const email = uniqEmail();
    await appFetch('/auth/sign-up/email', {
      method: 'POST',
      json: { name: 'Bad', email, password: 'correct-horse' },
    });
    const bad = await appFetch('/auth/sign-in/email', {
      method: 'POST',
      json: { email, password: 'wrong' },
    });
    expect(bad.status).toBe(401);
  });

  it('GET /auth/get-session returns null when unauthenticated', async () => {
    const res = await appFetch('/auth/get-session');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

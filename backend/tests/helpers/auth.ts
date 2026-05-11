/**
 * Signs users up through the real better-auth flow, captures the session
 * cookie, and exposes an `appFetch` that re-sends it. Tests run serially
 * (singleFork: true) so cross-test interference is the price of not
 * paying for a per-test schema.
 */

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { auth } from '../../src/auth/index.ts';
import { db } from '../../src/db/index.ts';
import { userRoles, users } from '../../src/db/schema.ts';
import { app } from '../../src/index.ts';
import type { Role } from 'bnr-shared';

export const TEST_PASSWORD = 'test-pass-1234';

export type TestUser = {
  id: string;
  email: string;
  cookie: string;
};

function uniqEmail(label: string): string {
  return `${label}-${randomUUID()}@bnr.test`;
}

/** Sign up + sign in + (optionally) grant roles. Returns the cookie header to reuse. */
export async function createTestUser(opts: {
  label: string;
  roles?: Role[];
  /** UUID of an existing admin to record as `granted_by`; defaults to the user themselves. */
  grantedBy?: string;
}): Promise<TestUser> {
  const email = uniqEmail(opts.label);
  const signUp = await auth.api.signUpEmail({
    body: { email, password: TEST_PASSWORD, name: opts.label },
    headers: new Headers(),
    asResponse: false,
  });
  const userId = (signUp as { user: { id: string } }).user.id;

  if (opts.roles && opts.roles.length > 0) {
    const grantedBy = opts.grantedBy ?? userId;
    await db
      .insert(userRoles)
      .values(opts.roles.map((role) => ({ userId, role, grantedBy })))
      .onConflictDoNothing();
  }

  // asResponse:true → we can read Set-Cookie off the Response.
  const signInRes = (await auth.api.signInEmail({
    body: { email, password: TEST_PASSWORD },
    asResponse: true,
  })) as Response;
  const setCookie = signInRes.headers.get('set-cookie');
  if (!setCookie) throw new Error('better-auth signIn produced no Set-Cookie');
  const cookie = setCookie.split(';')[0]!;

  return { id: userId, email, cookie };
}

export type FetchInit = RequestInit & { user?: TestUser; json?: unknown };

/** Hit the Hono app directly with an optional user cookie + JSON body. */
export async function appFetch(path: string, init: FetchInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.user) headers.set('cookie', init.user.cookie);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  return app.fetch(new Request(`http://localhost${path}`, { ...init, headers, body }));
}

export async function deleteUser(id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

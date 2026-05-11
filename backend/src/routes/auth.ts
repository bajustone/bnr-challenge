/**
 * Documented wrappers — the OpenAPI surface for /auth. Actual handling
 * delegates to `auth.handler(c.req.raw)`; anything under /auth/* not
 * declared here falls through to the catch-all in index.ts.
 */

import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { z } from 'zod';

import { auth } from '../auth/index.ts';

export const authRoutes = new Hono();

// requestBody schemas are inline OpenAPI fragments (TypeScript widens the
// literal to the right shape). Responses still use resolver(Zod) for the
// single-source-of-truth payload contract.

const SessionUser = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
});
const SessionRow = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  expiresAt: z.iso.datetime(),
});
const SessionResponse = z
  .object({ user: SessionUser, session: SessionRow })
  .meta({ id: 'SessionResponse' });
const GetSessionResponse = z
  .object({ user: SessionUser, session: SessionRow })
  .nullable()
  .meta({ id: 'GetSessionResponse' });
const SignUpResponse = z
  .object({ token: z.string(), user: SessionUser })
  .meta({ id: 'SignUpResponse' });
const SignOutResponse = z.object({ success: z.boolean() }).meta({ id: 'SignOutResponse' });

/** better-auth produces the canonical Response, including Set-Cookie. */
const forwardToBetterAuth = (c: { req: { raw: Request } }) =>
  auth.handler(c.req.raw) as Promise<Response>;

authRoutes.post(
  '/sign-up/email',
  describeRoute({
    summary: 'Create an account (email + password)',
    description:
      'Hashes the password with argon2id (Bun) or scrypt (Node fallback), creates the user + credential account, and returns the new user. Does not auto-sign-in — the client must POST /auth/sign-in/email next.',
    tags: ['auth'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'email', 'password'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 200 },
              email: { type: 'string', format: 'email' },
              password: { type: 'string', minLength: 8, maxLength: 200 },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Created',
        content: { 'application/json': { schema: resolver(SignUpResponse) } },
      },
      422: { description: 'Invalid email / password too short' },
    },
  }),
  forwardToBetterAuth,
);

authRoutes.post(
  '/sign-in/email',
  describeRoute({
    summary: 'Sign in (email + password)',
    description:
      'On success sets an HttpOnly, SameSite=Lax session cookie. The frontend should rely on the browser cookie store — never read the token from JS.',
    tags: ['auth'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string', minLength: 1, maxLength: 200 },
              rememberMe: { type: 'boolean' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Signed in — Set-Cookie is on the response',
        content: { 'application/json': { schema: resolver(SessionResponse) } },
      },
      401: { description: 'Bad credentials' },
    },
  }),
  forwardToBetterAuth,
);

authRoutes.post(
  '/sign-out',
  describeRoute({
    summary: 'Sign out',
    description:
      'Deletes the current session row and clears the cookie. Idempotent — returns 200 even with no session.',
    tags: ['auth'],
    responses: {
      200: {
        description: 'Signed out',
        content: { 'application/json': { schema: resolver(SignOutResponse) } },
      },
    },
  }),
  forwardToBetterAuth,
);

authRoutes.get(
  '/get-session',
  describeRoute({
    summary: 'Current session (cookie-based)',
    description:
      'Returns null when there is no session. Mirrors what GET /me exposes but without the role lookup — cheaper for "am I signed in?" gating in the UI shell.',
    tags: ['auth'],
    responses: {
      200: {
        description: 'Session or null',
        content: { 'application/json': { schema: resolver(GetSessionResponse) } },
      },
    },
  }),
  forwardToBetterAuth,
);

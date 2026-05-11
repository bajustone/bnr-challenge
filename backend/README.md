# bnr-backend

The API behind the BNR Licensing Portal. It runs on Bun, uses Hono as the HTTP framework, Drizzle for the database layer, better-auth for sessions, and talks to Postgres 17.

If you want the *why* behind any of these choices, the design write-up lives at [`docs/design.md`](../docs/design.md) at the repo root. It covers the stack and trade-offs, the schema and its invariants, the three-layer audit defence, the state machine, concurrency, and what we'd do differently with more time.

## Getting started

There are two ways to bring this up. Pick whichever fits your setup.

### The easy way: Docker

From the repo root:

```bash
bun install
bun docker:dev
```

That puts Postgres on `:5432` and the backend on `:3001`, with hot-reload watching the host filesystem. Migrations and the dev seed run on every startup, so you can stop and start the stack without worrying about state — it always comes back the same.

The API is at <http://localhost:3001>. The Scalar-rendered API reference is at <http://localhost:3001/docs>.

### The other way: local Bun against your own Postgres

If you'd rather run Bun directly on your machine and just bring a Postgres alongside:

```bash
docker run --name bnr-pg -d -p 5432:5432 \
  -e POSTGRES_USER=app_owner -e POSTGRES_PASSWORD=app_owner_pw \
  -e POSTGRES_DB=bnr postgres:17

cp .env.example .env
# fill in DATABASE_URL, DATABASE_OWNER_URL, AUDIT_HASH_SECRET

bun run db:migrate     # pre → drizzle → post (roles, grants, triggers)
bun run db:seed        # 4 users + 6 applications + audit rows
bun run dev:local      # http://localhost:3001 with hot reload
```

## Scripts

| Script | What it does |
|--------|--------------|
| `bun run dev` | Bring up the backend service via Docker Compose with the dev overlay |
| `bun run dev:local` | Hot-reload locally — assumes a database is already reachable |
| `bun run start` | One-shot production-like start, no hot reload |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Vitest suite (one fresh Postgres testcontainer per run) |
| `bun run test:watch` | Vitest in watch mode |
| `bun run db:generate` | `drizzle-kit generate` — diff the schema and emit a migration |
| `bun run db:migrate` | Apply pre + drizzle + post migrations; safe to run any time |
| `bun run db:seed` | Insert the dev users, applications, and one audit row each |
| `bun run db:studio` | Drizzle Studio — a browser GUI for the DB, using the owner connection |

## Environment

The defaults you need for local development:

```env
# .env.example
DATABASE_URL=postgres://app_user:app_user_pw@localhost:5432/bnr
DATABASE_OWNER_URL=postgres://app_owner:app_owner_pw@localhost:5432/bnr
AUDIT_HASH_SECRET=local-dev-pepper-change-me
STORAGE_DIR=./storage
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001
LOG_LEVEL=debug
```

There are **two** database URLs on purpose, and the distinction matters:

- `DATABASE_URL` connects as `app_user`. This is the runtime role. It can SELECT, INSERT, UPDATE, and DELETE on the normal domain tables — but on `audit_log` and `review_notes` it can only SELECT and INSERT. No updates, no deletes, ever.
- `DATABASE_OWNER_URL` connects as `app_owner`. It owns the schema and is used only by `src/db/migrate.ts` and `src/db/seed.ts`. Nothing in the request path ever touches it.

The grants and triggers in `migrations/sql/post/` enforce this even if a handler somewhere tries to misbehave — the database itself won't let it.

## Folder layout

```
backend/
├── migrations/
│   ├── 0000_*.sql                       drizzle-generated DDL
│   └── sql/
│       ├── pre/0001_extensions.sql      citext + pgcrypto
│       └── post/
│           ├── 0001_roles.sql           create app_user role
│           ├── 0002_grants.sql          per-table grants + default privileges
│           └── 0003_triggers.sql        terminal-state freeze + audit-log append-only
├── src/
│   ├── env.ts                  Zod-parsed env, validated at boot
│   ├── logger.ts               pino — pretty in dev, silent in tests, NDJSON in prod
│   ├── index.ts                Hono entrypoint, middleware chain, onError
│   ├── errors.ts               AppError hierarchy and HTTP status mapping
│   ├── db/
│   │   ├── schema.ts           10 tables, 3 enums, CHECK constraints, partial indexes
│   │   ├── index.ts            drizzle handle bound to DATABASE_URL
│   │   ├── migrate.ts          three-phase runner: pre → drizzle → post
│   │   ├── seed.ts             dev seed, idempotent
│   │   └── audit-hash.ts       canonical JSON + sha256 chain writer + verifier
│   ├── auth/
│   │   ├── index.ts            better-auth config and the applicant auto-grant hook
│   │   ├── middleware.ts       sessionMiddleware · requireAuth · loadRoles · requireRole
│   │   └── policy.ts           canView / canEdit / visibility filters
│   ├── middleware/
│   │   └── request-logger.ts   mints or honours x-request-id; one log line per request
│   ├── storage/
│   │   └── index.ts            tmp/ then atomic rename into sha256-addressed layout
│   ├── repositories/           the only place drizzle-orm is imported
│   │   └── *.repo.ts           factory(handle) → { method, … }
│   ├── services/               transaction-scoped orchestration; SM + repos + audit
│   │   └── *.service.ts
│   └── routes/                 Hono routers with describeRoute + Zod validators
│       ├── auth.ts             documented /auth/* wrappers
│       ├── me.ts
│       ├── applications.ts     CRUD + /transitions + /history
│       ├── documents.ts        multipart upload, streaming download
│       ├── review-notes.ts     staff post, filtered read
│       └── admin.ts            users, role grants, /audit/verify
└── tests/                      vitest + testcontainers
    ├── global-setup.ts         one Postgres container per `bun test` run
    └── *.test.ts
```

## Tests

```bash
bun run test
```

```
Test Files  10 passed (10)
     Tests  70 passed (70)
```

Each suite pins down a specific guarantee:

| Suite | What it pins |
|-------|--------------|
| `state-machine.test.ts` | Every legal edge is accepted; everything else returns `illegal_transition`; the dual-control, missing-message, and ownership guards all fire |
| `authorisation.test.ts` | The full role × route matrix is correct — 200 or 403 per cell; applicants get 403 on peer applications (not 404, which would leak existence); staff see everything |
| `concurrent-transition.test.ts` | Two `Promise.all`'d `mark_ready` calls on the same row produce exactly one 200, one 409, and one audit row |
| `uploads.test.ts` | 5 MiB exactly is OK, one byte more is a 413, wrong MIME is a 415, sha256 deduplicates, and slots version with supersede |
| `audit-chain.test.ts` | A clean chain verifies; tampering with `after_state` (after temporarily dropping the trigger) makes the verifier return the right `firstBadId`; restoring puts it back |
| `review-notes.test.ts` | Visibility filtering works, applicants get 403 on POST, `request_info` without a message returns 422, and the grant blocks UPDATE on `review_notes` |
| `auth-routes.test.ts` | The full sign-up → sign-in → `/me` (with role) → sign-out cookie round-trip works, and the OpenAPI cookieAuth scheme is present |
| `cors.test.ts` | Preflight from an allowed origin succeeds, the allow-origin header is echoed on real requests, and an unlisted origin gets no header back |
| `db.test.ts` | The schema is present, `citext` and `pgcrypto` are installed, and the audit-log trigger blocks UPDATE |
| `routes.test.ts` | The public surface (`/`, `/health`, `/openapi.json`, `/docs`) responds |

### Debugging a failing test

Under Vitest, the logger is silent by default, which is normally what you want — but when something's misbehaving you want to see the request log. Flip `BNR_DEBUG_TESTS=1` and you'll get debug-level logs through the run:

```bash
BNR_DEBUG_TESTS=1 bun run test tests/uploads.test.ts
```

The global setup honours that flag and bumps `LOG_LEVEL` to `debug`.

### Running just one file

```bash
bun run test tests/state-machine.test.ts
```

A small note: every DB-touching test shares the same testcontainer, so anything that mutates global state needs to clean up after itself. `audit-chain.test.ts` is the canonical example — it temporarily drops the append-only trigger so it can tamper with a row, then puts it back.

## Adding or changing a migration

The workflow is:

1. Edit `src/db/schema.ts`.
2. Run `bun run db:generate`. Drizzle diffs your schema against the migrations folder and writes the next file.
3. Open the new `migrations/000N_*.sql` and look at it — `drizzle-kit` sometimes produces odd column orders, and it's worth a sanity check.
4. Run `bun run db:migrate`. It's idempotent against a freshly-bumped schema.

If you're touching roles, grants, or triggers, edit a file in `migrations/sql/post/` instead. Those re-run on every migration, so any new table you add automatically picks up the right grants without needing a separate migration. The pre-migration phase (`migrations/sql/pre/`) is only for extensions — right now that's `citext` and `pgcrypto`.

## How auth works

- The browser holds an `HttpOnly; SameSite=Lax` session cookie, issued by `POST /auth/sign-in/email`.
- Passwords are hashed with Argon2id under Bun (in production) and scrypt under Node (during Vitest).
- Roles are stored in a separate `user_roles (user_id, role)` table and loaded once per request by the `loadRoles` middleware.
- Self-signup auto-grants `applicant` via better-auth's `databaseHooks`.
- Staff roles (`reviewer`, `approver`, `admin`) only come from an admin granting them through `POST /admin/users/:id/roles`, and that grant is itself audited.
- better-auth's `trustedOrigins` and Hono's CORS middleware both read from `ALLOWED_ORIGINS`, so there's one place to change it.

## The state machine

The transition logic is a pure function in `shared/src/domain/state-machine.ts`. It runs three checks, in order:

1. **Is this a legal edge?** — i.e. is `(currentStatus, event)` actually a transition on the diagram?
2. **Does the actor have the right role?** — each edge is owned by a specific role.
3. **Dual control** — `approve` and `reject` are rejected if `actor.id === application.reviewedBy`. The same person can't both review and decide.

The frontend imports the same module to figure out which buttons to render — so the UI never shows an action the backend would reject. The service layer imports it to translate a successful transition into the right `UPDATE`.

## The audit chain

There are three independent layers of defence on the audit log:

1. **Grants.** `app_user` only has `SELECT` and `INSERT`. No update, no delete.
2. **Trigger.** A `BEFORE UPDATE | DELETE | TRUNCATE` trigger raises an exception — and it fires even for `app_owner`, so a buggy migration can't damage history either.
3. **Hash chain.** Each row's `row_hash` is `sha256(prev_hash || canonical_json(row) || AUDIT_HASH_SECRET)`. `GET /admin/audit/verify` walks the chain and returns the first bad ID if anything ever falls out of order.

If `AUDIT_HASH_SECRET` changes between writes and verification, the chain fails to verify — that's by design. Rotate it carefully.

## OpenAPI

The OpenAPI document is generated from the same Zod schemas the handlers validate against, so it can't drift. `cookieAuth` is declared globally; the few public routes (`/health`, `/auth/sign-up/email`, `/auth/sign-in/email`, `/auth/get-session`, `/`, `/docs`) opt out with `security: []`.

Open <http://localhost:3001/docs> — that's the Scalar UI served from CDN, so it doesn't add anything to the bundle.

## Things you'll probably want to do at some point

```bash
# Open the DB GUI
bun run db:studio

# Apply schema changes
bun run db:generate && bun run db:migrate

# Reset everything in dev
bun docker:dev:down -v && bun docker:dev

# Run one test
bun run test tests/concurrent-transition.test.ts

# Trace a specific request through the logs
curl -i http://localhost:3001/health      # grab the x-request-id from the response,
                                          # then grep the backend container log for it
```

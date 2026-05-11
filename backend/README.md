# bnr-backend

Bun + Hono API for the BNR Licensing Portal. Drizzle ORM, Postgres 17, better-auth.

> Domain reasoning lives in `docs/BNR Portal — architecture-thinking.html` (stack), `docs/BNR Portal — db-architecture.html` (schema), and `docs/BNR Portal — implementation plan.html` (phase order).

## Quick start

### Option A — Docker (recommended)

From the repo root:

```bash
bun install
bun docker:dev                # postgres :5432, backend :3001
                              # idempotent: migrate + seed run every start
                              # hot-reload from the host
```

Backend at <http://localhost:3001>. API reference at <http://localhost:3001/docs>.

### Option B — local Bun + your own Postgres

```bash
docker run --name bnr-pg -d -p 5432:5432 \
  -e POSTGRES_USER=app_owner -e POSTGRES_PASSWORD=app_owner_pw \
  -e POSTGRES_DB=bnr postgres:17

cp .env.example .env
# edit DATABASE_URL / DATABASE_OWNER_URL / AUDIT_HASH_SECRET

bun run db:migrate            # pre → drizzle → post (roles, grants, triggers)
bun run db:seed               # 4 users + 6 applications + audit rows
bun run dev:local             # http://localhost:3001 with hot reload
```

## Scripts

| Script | What it does |
|--------|--------------|
| `bun run dev` | Compose-up the backend service (default; uses the dev overlay) |
| `bun run dev:local` | Hot-reload locally; requires DB to already be reachable |
| `bun run start` | One-shot start (production-like, no hot reload) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Vitest suite (uses testcontainers; one Postgres per run) |
| `bun run test:watch` | Vitest watch mode |
| `bun run db:generate` | `drizzle-kit generate` — diff schema → emit migration |
| `bun run db:migrate` | Apply pre + drizzle + post; idempotent on a clean or running DB |
| `bun run db:seed` | Insert dev users + applications + one audit row each |
| `bun run db:studio` | `drizzle-kit studio` — DB GUI via the owner connection |

## Environment

```env
# .env.example
DATABASE_URL=postgres://app_user:app_user_pw@localhost:5432/bnr
DATABASE_OWNER_URL=postgres://app_owner:app_owner_pw@localhost:5432/bnr
AUDIT_HASH_SECRET=local-dev-pepper-change-me
STORAGE_DIR=./storage
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001
LOG_LEVEL=debug
```

Two URLs by design:

- `DATABASE_URL` connects as `app_user` — runtime; has `SELECT, INSERT, UPDATE, DELETE` on domain tables, **SELECT + INSERT only** on `audit_log` and `review_notes`.
- `DATABASE_OWNER_URL` connects as `app_owner` — DDL, migrations, seeds. Used **only** by `src/db/migrate.ts` and `src/db/seed.ts`.

Grants and triggers in `migrations/sql/post/` enforce the boundary even if a buggy handler tries to bypass it.

## Layout

```
backend/
├── migrations/
│   ├── 0000_*.sql                drizzle-generated DDL
│   └── sql/
│       ├── pre/0001_extensions.sql       citext + pgcrypto
│       └── post/
│           ├── 0001_roles.sql            create app_user role (NOLOGIN by default)
│           ├── 0002_grants.sql           per-table grants + default privileges
│           └── 0003_triggers.sql         terminal-state freeze + audit_log append-only
├── src/
│   ├── env.ts                    Zod-parsed env (process.env validated at boot)
│   ├── logger.ts                 pino; dev → pretty, test → silent, prod → NDJSON
│   ├── index.ts                  Hono entrypoint + middleware chain + onError
│   ├── errors.ts                 AppError hierarchy + HTTP status mapping
│   ├── db/
│   │   ├── schema.ts             10 tables, 3 enums, CHECK constraints, partial indexes
│   │   ├── index.ts              drizzle handle bound to DATABASE_URL
│   │   ├── migrate.ts            three-phase runner (pre → drizzle → post)
│   │   ├── seed.ts               dev seed; idempotent
│   │   └── audit-hash.ts         canonical JSON + sha256 chain writer + verifier helper
│   ├── auth/
│   │   ├── index.ts              better-auth config + applicant auto-grant hook
│   │   ├── middleware.ts         sessionMiddleware · requireAuth · loadRoles · requireRole
│   │   └── policy.ts             canView / canEdit / visibility filters
│   ├── middleware/
│   │   └── request-logger.ts     mints / honours x-request-id; one structured line per request
│   ├── storage/
│   │   └── index.ts              tmp/ → sha256 layout; atomic rename
│   ├── repositories/             only place drizzle-orm is imported
│   │   └── *.repo.ts             factory(handle) → { method, … }
│   ├── services/                 tx-scoped orchestration; calls SM + repos + audit
│   │   └── *.service.ts
│   └── routes/                   Hono routers with describeRoute + Zod validators
│       ├── auth.ts               documented /auth/* wrappers
│       ├── me.ts
│       ├── applications.ts       CRUD + /transitions + /history
│       ├── documents.ts          multipart upload + streaming download
│       ├── review-notes.ts       staff post / filtered read
│       └── admin.ts              users + role grants + /audit/verify
└── tests/                        vitest + testcontainers
    ├── global-setup.ts           one Postgres container per `bun test` run
    └── *.test.ts                 see "Tests" below
```

## Tests

```bash
bun run test
```

```
Test Files  10 passed (10)
     Tests  70 passed (70)
```

| Suite | What it pins |
|-------|--------------|
| `state-machine.test.ts` | Every legal edge accepted; non-edges return `illegal_transition`; dual-control / missing-message / ownership guards fire |
| `authorisation.test.ts` | Role × route table — 200/403 per cell; applicants 403 (not 404) on peer applications; staff see all |
| `concurrent-transition.test.ts` | `Promise.all` two `mark_ready` on the same row → exactly one 200, one 409, **one** audit row |
| `uploads.test.ts` | 5 MiB exact OK; +1 byte 413; 415 on bad MIME; sha256 dedup; slot versioning + supersede |
| `audit-chain.test.ts` | Clean chain verifies; tamper with `after_state` (trigger temporarily dropped) → verifier returns the right `firstBadId`; revert restores |
| `review-notes.test.ts` | Visibility filter; applicant 403 on POST; `request_info` without message returns 422; grant denies UPDATE on `review_notes` |
| `auth-routes.test.ts` | Sign-up → sign-in → `/me` (with role) → sign-out cookie round-trip; OpenAPI cookieAuth scheme present |
| `cors.test.ts` | Preflight from allowed origin; actual-request echo; unlisted origin gets no allow-origin header |
| `db.test.ts` | Schema present; citext + pgcrypto installed; audit-log trigger blocks UPDATE |
| `routes.test.ts` | Public surface smoke (`/`, `/health`, `/openapi.json`, `/docs`) |

### Debugging a test

The logger is silent under Vitest by default. To see structured logs from a route during a test, set `BNR_DEBUG_TESTS=1`:

```bash
BNR_DEBUG_TESTS=1 bun run test tests/uploads.test.ts
```

The global-setup honours that flag and bumps `LOG_LEVEL` to `debug`.

### Running one file

```bash
bun run test tests/state-machine.test.ts
```

Note: every test that talks to the DB shares the same testcontainer; tests inside a file should clean up any global state they mutate (e.g. `audit-chain.test.ts` drops + restores the append-only trigger).

## Migration workflow

```bash
# 1. Edit src/db/schema.ts.
# 2. Generate the diff.
bun run db:generate
# 3. Inspect migrations/000N_*.sql — drizzle-kit might produce odd column orders.
# 4. Run it. Idempotent against a freshly-bumped schema.
bun run db:migrate
```

For roles / grants / triggers, edit a file in `migrations/sql/post/` — those re-run on every migrate so new tables inherit grants without a separate migration. The pre-DDL (`migrations/sql/pre/`) installs extensions; only `citext` and `pgcrypto` today.

## Auth

- Session **cookie** (`HttpOnly; SameSite=Lax`) issued by `POST /auth/sign-in/email`.
- Argon2id under Bun (production), scrypt under Node (vitest).
- Roles live in `user_roles (user_id, role)`; loaded once per request by `loadRoles` middleware.
- `applicant` is auto-granted on self sign-up (better-auth `databaseHooks`).
- Staff roles (`reviewer`, `approver`, `admin`) are granted by an admin via `POST /admin/users/:id/roles` (audited).
- `trustedOrigins` for better-auth mirrors `ALLOWED_ORIGINS` for the Hono CORS middleware — one source of truth.

## State machine

Pure function in `shared/src/domain/state-machine.ts`. Three checks, in order:

1. **Legal edge** — `(currentStatus, event)` on the diagram.
2. **Role guard** — actor holds a role that owns the edge.
3. **Dual control** — `approve` / `reject` rejected when `actor.id === application.reviewedBy`.

Same module imported by the frontend (so it renders only the buttons the backend would accept) and by the service (which translates the SM result into an `UPDATE`).

## Audit chain

Three defences:

1. **Grants** — `app_user` has `SELECT, INSERT` only on `audit_log`.
2. **Trigger** — `BEFORE UPDATE | DELETE | TRUNCATE` raises an exception (even for `app_owner`).
3. **Hash chain** — `row_hash = sha256(prev_hash || canonical_json(row) || AUDIT_HASH_SECRET)`. Verifier walks the chain on `GET /admin/audit/verify`.

If `AUDIT_HASH_SECRET` changes between writes and verification, the chain fails to verify — by design.

## OpenAPI

Generated from the same Zod schemas the handlers use. `cookieAuth` is declared globally; public routes (`/health`, `/auth/sign-up/email`, `/auth/sign-in/email`, `/auth/get-session`, `/`, `/docs`) opt out via `security: []`.

Open <http://localhost:3001/docs> — Scalar UI from CDN, no extra bundle in our code.

## Common dev tasks

```bash
# Open the DB GUI:
bun run db:studio                       # opens drizzle-kit studio

# Apply schema changes:
bun run db:generate && bun run db:migrate

# Reset everything in dev:
bun docker:dev:down -v && bun docker:dev

# Run a single test:
bun run test tests/concurrent-transition.test.ts

# Watch logs for a specific request id:
curl -i http://localhost:3001/health    # note x-request-id header in response,
                                        # then grep the backend container log for it
```

# bnr-backend

Bun + Hono + Drizzle + Postgres 17 + better-auth.

API docs: <http://localhost:3001/docs> (Scalar, served from the running backend).
Design notes: [`../docs/design.md`](../docs/design.md).

## Run

From the repo root:

```bash
bun docker:dev
```

Or locally against your own Postgres:

```bash
cp .env.example .env         # fill DATABASE_URL, DATABASE_OWNER_URL, AUDIT_HASH_SECRET
bun run db:migrate
bun run db:seed
bun run dev:local
```

## Scripts

| Script | What it does |
|--------|--------------|
| `bun run dev:local` | Hot reload, assumes DB is up |
| `bun run test` | Vitest (testcontainers Postgres) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run db:generate` | Diff schema → migration file |
| `bun run db:migrate` | Apply pre + drizzle + post migrations |
| `bun run db:seed` | Insert dev users + applications |
| `bun run db:studio` | Drizzle Studio GUI |

## Env

```env
DATABASE_URL=postgres://app_user:app_user_pw@localhost:5432/bnr
DATABASE_OWNER_URL=postgres://app_owner:app_owner_pw@localhost:5432/bnr
AUDIT_HASH_SECRET=local-dev-pepper-change-me
STORAGE_DIR=./storage
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001
LOG_LEVEL=debug
```

Two DB users on purpose: `app_user` is the runtime (no UPDATE/DELETE on `audit_log`), `app_owner` is for migrations and seed only.

## Debugging a test

```bash
BNR_DEBUG_TESTS=1 bun run test tests/uploads.test.ts
```

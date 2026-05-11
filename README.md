# BNR Licensing & Compliance Portal

Monolith for the National Bank of Rwanda licensing & compliance portal.

| Package | Stack | Role |
|---------|-------|------|
| [`backend/`](./backend/) | Bun · Hono · Drizzle · better-auth · Postgres 17 | API, workflow, audit, document storage |
| [`frontend/`](./frontend/) | SvelteKit 2 · Svelte 5 runes · Tailwind v4 · shadcn-svelte | Applicant + reviewer / approver / admin UI |
| [`shared/`](./shared/) | Pure TypeScript | State machine, enums, domain types both packages import |
| [`docker/`](./docker/) | Compose | Postgres + backend service for one-command bring-up |
| [`docs/`](./docs/) | HTML, SVG | Brief, design docs, architecture diagrams |

> **Read first:**
> [`docs/diagrams/app-architecture.svg`](./docs/diagrams/app-architecture.svg) ·
> [`docs/diagrams/db-architecture.svg`](./docs/diagrams/db-architecture.svg)

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3 (used by both backend runtime and frontend tooling)
- Docker (for the one-command stack)
- Node ≥ 22 only if you want to run the Vitest suite outside Bun

## One-command bring-up

```bash
bun install
bun docker:dev                # postgres :5432, backend :3001, hot reload
                              # idempotent: runs migrate + seed every start
```

Tear down:

```bash
bun docker:dev:down           # stop containers, keep volumes
bun docker:dev:down -v        # wipe pg_data + bnr_storage
```

Then in a second terminal for the UI:

```bash
bun --cwd frontend dev        # http://localhost:5173
```

Open the API reference: <http://localhost:3001/docs>.

## Dev credentials

The dev seed inserts one user per role. Password for every user is `bnr-dev-pass`.

| Email                   | Role        | Can do                                           |
|-------------------------|-------------|--------------------------------------------------|
| `applicant@bnr.local`   | applicant   | Create / patch / submit / resubmit / withdraw apps, upload docs |
| `reviewer@bnr.local`    | reviewer    | Assign / request info / mark ready               |
| `approver@bnr.local`    | approver    | Approve / reject (dual control — not the reviewer) |
| `admin@bnr.local`       | admin       | Grant + revoke roles, audit query + verify       |

Self sign-up via `/auth/sign-up/email` auto-grants the `applicant` role; staff roles are granted by an admin (`POST /admin/users/:id/roles`).

## Full-stack demo (≈ 1 minute)

```bash
BASE=http://localhost:3001

# 1. Applicant signs in
curl -c cookies.txt -X POST $BASE/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"applicant@bnr.local","password":"bnr-dev-pass"}'

# 2. Create + upload + submit
APP=$(curl -sb cookies.txt -X POST $BASE/applications \
  -H 'content-type: application/json' \
  -d '{"institutionName":"Demo Bank","institutionType":"commercial_bank"}' \
  | jq -r .id)

echo 'pretend pdf' > plan.pdf
curl -b cookies.txt -X POST $BASE/applications/$APP/documents \
  -F slot=business-plan -F file=@plan.pdf

curl -b cookies.txt -X POST $BASE/applications/$APP/transitions \
  -H 'content-type: application/json' -d '{"event":"submit"}'

# 3. Reviewer takes it through to READY_FOR_DECISION
curl -c cookies.txt -X POST $BASE/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"reviewer@bnr.local","password":"bnr-dev-pass"}'
curl -b cookies.txt -X POST $BASE/applications/$APP/transitions \
  -H 'content-type: application/json' -d '{"event":"assign"}'
curl -b cookies.txt -X POST $BASE/applications/$APP/transitions \
  -H 'content-type: application/json' -d '{"event":"mark_ready"}'

# 4. Approver approves (dual control — different user from reviewer)
curl -c cookies.txt -X POST $BASE/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"approver@bnr.local","password":"bnr-dev-pass"}'
curl -b cookies.txt -X POST $BASE/applications/$APP/transitions \
  -H 'content-type: application/json' -d '{"event":"approve"}'

# 5. Admin verifies the audit hash chain
curl -c cookies.txt -X POST $BASE/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"admin@bnr.local","password":"bnr-dev-pass"}'
curl -b cookies.txt $BASE/admin/audit/verify
# → {"ok":true,"lastVerifiedId":"…","firstBadId":null,"rowsChecked":…}
```

## Workspace scripts

Run from the repo root:

| Command | What it does |
|---------|--------------|
| `bun docker:dev` | Up the dev stack (postgres + backend, hot reload, idempotent migrate + seed) |
| `bun docker:dev:down` | Stop the stack |
| `bun docker:dev:down -v` | Stop + wipe volumes (pg_data + uploaded blobs) |
| `bun run dev` | `bun --filter '*' dev` — alias for both packages |
| `bun --cwd backend test` | Backend Vitest suite (uses testcontainers; ~5 s after first run) |
| `bun --cwd backend typecheck` | `tsc --noEmit` |
| `bun --cwd backend db:migrate` | Apply pre + drizzle + post migrations (idempotent) |
| `bun --cwd backend db:seed` | Insert seed users + applications |
| `bun --cwd backend db:studio` | `drizzle-kit studio` (DB GUI, owner connection) |
| `bun --cwd frontend dev` | SvelteKit dev server on :5173 |
| `bun --cwd frontend check` | Svelte + TS type-check |
| `bun --cwd frontend build` | Production build |

## Tests

```bash
bun --cwd backend test
```

```
Test Files  10 passed
     Tests  70 passed
```

| Suite | Proves |
|-------|--------|
| `state-machine.test.ts` | Every legal edge; non-edges return `illegal_transition`; dual-control + RFI message + ownership |
| `authorisation.test.ts` | Role × route table; 403 (not 404) on peer applications; staff vs applicant scoping |
| `concurrent-transition.test.ts` | Two simultaneous `mark_ready` → exactly one 200, one 409, one audit row |
| `uploads.test.ts` | 5 MiB exact OK; +1 byte 413; 415 on bad MIME; sha256 dedup; slot versioning |
| `audit-chain.test.ts` | Clean chain verifies; tampered `after_state` flips `firstBadId` |
| `review-notes.test.ts` | Visibility filter; applicant 403 on POST; missing RFI message 422; grant denies UPDATE |
| `auth-routes.test.ts` | Sign-up → sign-in → /me → sign-out cookie round-trip; OpenAPI security scheme |
| `cors.test.ts` | CORS preflight; allow-origin echo; unlisted origin rejected |
| `db.test.ts` | Schema + extensions + audit trigger present |
| `routes.test.ts` | `/`, `/health`, `/openapi.json`, `/docs` smoke |

See [`backend/README.md`](./backend/README.md#tests) for how to debug a failing test.

## Environment

The dev compose overlay hardcodes everything you need. For a non-Docker run, copy `.env.example` into the workspace you're touching:

| Variable | Where it's read | Default | Notes |
|----------|-----------------|---------|-------|
| `DATABASE_URL` | backend | — | `postgres://app_user:…/bnr` (no UPDATE/DELETE on audit_log) |
| `DATABASE_OWNER_URL` | backend (migrate + seed only) | — | `postgres://app_owner:…/bnr` |
| `AUDIT_HASH_SECRET` | backend | (none) | Optional pepper; if set, must be present at verify time too |
| `STORAGE_DIR` | backend | `./storage` | Compose overrides to `/var/lib/bnr/storage` |
| `ALLOWED_ORIGINS` | backend | `http://localhost:5173,http://localhost:3001` | Comma-separated; used by CORS **and** better-auth `trustedOrigins` |
| `BETTER_AUTH_URL` | backend | derived from `PORT` | Used for callback URLs |
| `LOG_LEVEL` | backend | `debug` in dev, `info` in prod, `silent` in tests | pino level |
| `BACKEND_URL` | frontend | `http://localhost:3001` | Both for Vite proxy and for `+server` route fetches |

## Documentation

| File | Purpose |
|------|---------|
| `docs/BNR Portal — architecture-thinking.html` | Stack choices + trade-offs |
| `docs/BNR Portal — db-architecture.html` | Schema, invariants, three-layer audit defence |
| `docs/BNR Portal — implementation plan.html` | Phase-by-phase build order, status table |
| `docs/diagrams/app-architecture.svg` | Visual: request flow through the stack |
| `docs/diagrams/db-architecture.svg` | Visual: tables + FKs + invariants |

## What's deliberately not done

- **S3 / cloud blob storage** — documents live on the `bnr_storage` named volume. Path of swap: replace `backend/src/storage/index.ts`; addressing stays by sha256.
- **OAuth / MFA / email verification** — better-auth supports them, out of scope for the brief.
- **Per-test DB schema isolation** — one container, one shared DB, serial execution (`singleFork: true`). Carefully restored where any test mutates shared state.
- **PII redaction in `before_state` / `after_state`** — full row snapshots. A regulator-grade deployment would scrub or encrypt these.

## What I would do differently with more time

- Unified hasher (no Bun/Node split — pick a Node-native argon2 package).
- Per-test schema → re-enable parallel test execution.
- Frontend feature parity for reviewer + approver flows beyond the current login gate.
- Incremental audit-chain verification on append rather than full-table walk.

## License

Private.

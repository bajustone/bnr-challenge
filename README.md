# BNR Licensing & Compliance Portal

This is the licensing and compliance portal for the National Bank of Rwanda — a place where banks and other financial institutions apply for a license, where BNR reviewers and approvers walk those applications through to a decision, and where admins keep the whole thing honest with an auditable paper trail.

It's a monolith, on purpose. Everything you need lives in this one repo.

## What's inside

The repo is split into a few folders, each with a clear job:

- **`backend/`** is the API. It's written in TypeScript on Bun, uses Hono as the HTTP framework, Drizzle for the database layer, and better-auth for sessions. Postgres 17 sits behind it. This is where the workflow logic lives, where documents get stored, and where the audit chain is maintained.
- **`frontend/`** is the user interface. SvelteKit 2 with Svelte 5 runes, styled with Tailwind v4, and built on shadcn-svelte components. It's what applicants, reviewers, approvers, and admins actually see in their browser.
- **`shared/`** is a small pure-TypeScript package — the state machine, the enums, the domain types. Both the backend and frontend import from it, so the rules of the workflow are defined in exactly one place.
- **`docker/`** holds the Compose files that bring the whole thing up with a single command.
- **`docs/`** has the design write-ups and architecture diagrams. If you only have time to look at two things, look at [`docs/diagrams/app-architecture.svg`](./docs/diagrams/app-architecture.svg) and [`docs/diagrams/db-architecture.svg`](./docs/diagrams/db-architecture.svg). They'll save you a lot of reading.

## Before you start

You'll need:

- [Bun](https://bun.sh) version 1.3 or newer. The backend runs on it, and the frontend's tooling uses it too.
- Docker, so the one-command stack works.
- Node 22+ only if for some reason you want to run the Vitest suite outside of Bun. You probably don't.

## Getting it running

The fast path is one install plus one Docker command:

```bash
bun install
bun docker:dev
```

That second command brings up Postgres on `:5432` and the backend on `:3001`, with hot-reload wired up to the host. It's idempotent — every time you run it, it re-applies migrations and re-seeds the dev users, so you can stop and start it without worrying.

When you're done, either of these will tear it back down:

```bash
bun docker:dev:down       # stop, but keep the data
bun docker:dev:down -v    # stop and wipe the volumes (Postgres data + uploaded files)
```

For the UI, open a second terminal and run:

```bash
bun --cwd frontend dev
```

That gives you the frontend on <http://localhost:5173>. The API reference (Scalar UI, served straight out of the backend) is at <http://localhost:3001/docs>.

## Logging in during development

The seed script inserts one user for each role. They all share the same password: `bnr-dev-pass`.

| Email                   | Role        | What they can do                                                   |
|-------------------------|-------------|--------------------------------------------------------------------|
| `applicant@bnr.local`   | applicant   | Create, edit, submit, resubmit, and withdraw applications; upload documents |
| `reviewer@bnr.local`    | reviewer    | Pick up applications, request more info, mark them ready for a decision     |
| `approver@bnr.local`    | approver    | Approve or reject — but only if they weren't the one who reviewed it        |
| `admin@bnr.local`       | admin       | Grant and revoke roles, query and verify the audit log                       |

If you sign yourself up through `/auth/sign-up/email`, you'll get the `applicant` role automatically. Staff roles only come from an admin granting them via `POST /admin/users/:id/roles`.

## A full workflow in a minute, from the terminal

This is the whole happy path, end to end. Copy it into a terminal once the stack is up and you'll see an application go from "applicant submits" to "approver signs off" to "admin checks the audit chain hasn't been tampered with":

```bash
BASE=http://localhost:3001

# 1. Applicant signs in
curl -c cookies.txt -X POST $BASE/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"applicant@bnr.local","password":"bnr-dev-pass"}'

# 2. Create an application, upload a doc, submit it
APP=$(curl -sb cookies.txt -X POST $BASE/applications \
  -H 'content-type: application/json' \
  -d '{"institutionName":"Demo Bank","institutionType":"commercial_bank"}' \
  | jq -r .id)

echo 'pretend pdf' > plan.pdf
curl -b cookies.txt -X POST $BASE/applications/$APP/documents \
  -F slot=business-plan -F file=@plan.pdf

curl -b cookies.txt -X POST $BASE/applications/$APP/transitions \
  -H 'content-type: application/json' -d '{"event":"submit"}'

# 3. Reviewer picks it up and marks it ready for decision
curl -c cookies.txt -X POST $BASE/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"reviewer@bnr.local","password":"bnr-dev-pass"}'
curl -b cookies.txt -X POST $BASE/applications/$APP/transitions \
  -H 'content-type: application/json' -d '{"event":"assign"}'
curl -b cookies.txt -X POST $BASE/applications/$APP/transitions \
  -H 'content-type: application/json' -d '{"event":"mark_ready"}'

# 4. Approver approves — note this has to be a different user from the reviewer
curl -c cookies.txt -X POST $BASE/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"approver@bnr.local","password":"bnr-dev-pass"}'
curl -b cookies.txt -X POST $BASE/applications/$APP/transitions \
  -H 'content-type: application/json' -d '{"event":"approve"}'

# 5. Admin asks the system to walk the audit chain and confirm nothing was tampered with
curl -c cookies.txt -X POST $BASE/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"admin@bnr.local","password":"bnr-dev-pass"}'
curl -b cookies.txt $BASE/admin/audit/verify
# → {"ok":true,"lastVerifiedId":"…","firstBadId":null,"rowsChecked":…}
```

## Scripts you'll actually use

All of these run from the repo root:

| Command | What it does |
|---------|--------------|
| `bun docker:dev` | Bring up Postgres and the backend in dev mode, hot-reload and all |
| `bun docker:dev:down` | Stop the stack |
| `bun docker:dev:down -v` | Stop the stack and wipe the data volumes |
| `bun run dev` | Shorthand for running dev mode in every workspace at once |
| `bun --cwd backend test` | Run the backend Vitest suite (around 5 seconds after the first run) |
| `bun --cwd backend typecheck` | TypeScript check, no emit |
| `bun --cwd backend db:migrate` | Apply pre, drizzle, and post migrations — safe to run any time |
| `bun --cwd backend db:seed` | Re-insert the seed users and applications |
| `bun --cwd backend db:studio` | Open the Drizzle Studio DB GUI |
| `bun --cwd frontend dev` | SvelteKit dev server on :5173 |
| `bun --cwd frontend check` | Svelte + TypeScript type-check |
| `bun --cwd frontend build` | Production build |

## Tests

```bash
bun --cwd backend test
```

You should see:

```
Test Files  10 passed
     Tests  70 passed
```

Each suite is there for a reason — to pin down behaviour we don't want to drift:

| Suite | What it guarantees |
|-------|--------------------|
| `state-machine.test.ts` | Every legal state transition works; everything else returns `illegal_transition`; dual control, the RFI message requirement, and ownership rules all fire correctly |
| `authorisation.test.ts` | The role × route table is enforced; peer applications return 403 (not 404, that would leak existence); staff and applicants see only what they're supposed to |
| `concurrent-transition.test.ts` | Two simultaneous `mark_ready` calls on the same row produce exactly one success, one 409, and one audit row — no duplicates |
| `uploads.test.ts` | 5 MiB exactly is fine, one byte more is a 413, wrong MIME is a 415, identical files are deduped by sha256, and slots version correctly |
| `audit-chain.test.ts` | The hash chain verifies cleanly when intact, and tampering with `after_state` flips `firstBadId` exactly where you'd expect |
| `review-notes.test.ts` | Visibility filtering works, applicants can't POST, an RFI without a message gets a 422, and the DB grant blocks UPDATE on review notes |
| `auth-routes.test.ts` | Sign-up → sign-in → `/me` → sign-out round-trips correctly, and the OpenAPI doc has the cookie auth scheme |
| `cors.test.ts` | Preflight from an allowed origin works, the allow-origin header is echoed, and an unlisted origin is rejected |
| `db.test.ts` | The schema is there, the extensions are installed, and the audit trigger is active |
| `routes.test.ts` | The public surface (`/`, `/health`, `/openapi.json`, `/docs`) responds |

If a test starts failing and you want to see what's happening inside, [`backend/README.md`](./backend/README.md#tests) walks through how to turn on logging during a test run.

## Environment variables

The Compose overlay for dev hardcodes everything you need, so most of the time you don't have to think about this. If you do want to run things outside Docker, copy `.env.example` from the workspace you're in and fill in:

| Variable | Where it's read | Default | Notes |
|----------|-----------------|---------|-------|
| `DATABASE_URL` | backend | — | The runtime connection — `app_user` role, no UPDATE or DELETE on `audit_log` |
| `DATABASE_OWNER_URL` | backend, migrate + seed only | — | The owner connection — used only for DDL and seeding |
| `AUDIT_HASH_SECRET` | backend | (none) | Optional pepper for the audit hash. If you set it for writes, it has to be set for verification too |
| `STORAGE_DIR` | backend | `./storage` | Where uploaded documents land. Compose overrides this to `/var/lib/bnr/storage` |
| `ALLOWED_ORIGINS` | backend | `http://localhost:5173,http://localhost:3001` | Comma-separated list. Used by CORS and by better-auth's `trustedOrigins` |
| `BETTER_AUTH_URL` | backend | derived from `PORT` | Used for callback URLs |
| `LOG_LEVEL` | backend | `debug` in dev, `info` in prod, `silent` in tests | pino log level |
| `BACKEND_URL` | frontend | `http://localhost:3001` | Used by the Vite proxy and by SvelteKit's server-side `fetch` |

## Where to read more

If you want the reasoning behind the choices, the `docs/` folder has more substantial write-ups:

| File | What's in it |
|------|--------------|
| `docs/BNR Portal — architecture-thinking.html` | Why we picked the stack we did, and the trade-offs we made |
| `docs/BNR Portal — db-architecture.html` | The schema, the invariants, and the three layers of audit defence |
| `docs/BNR Portal — implementation plan.html` | The phase-by-phase build order and what's done so far |
| `docs/diagrams/app-architecture.svg` | A picture of how a request flows through the system |
| `docs/diagrams/db-architecture.svg` | A picture of the tables, foreign keys, and invariants |

## Things we deliberately left out

A few choices were made on purpose, to keep the scope honest:

- **S3 or cloud blob storage.** Documents live on a named Docker volume (`bnr_storage`). If you wanted to swap in S3, you'd replace `backend/src/storage/index.ts` — the addressing stays the same since it's all keyed by sha256.
- **OAuth, MFA, email verification.** better-auth supports all of them; we just didn't need them for this brief.
- **Per-test database isolation.** All tests share one Postgres testcontainer and run serially (`singleFork: true`). Anything that mutates global state is carefully restored.
- **PII redaction in `before_state` and `after_state`.** We store full row snapshots. A regulator-grade deployment would scrub or encrypt these fields.

## Things we'd do differently with more time

- Pick a single password hasher that works on both Bun and Node, instead of the Bun/Node split we have now.
- Per-test schemas, so the suite can run in parallel.
- Build out the reviewer and approver flows in the frontend to match the API surface.
- Incremental audit-chain verification on each append, instead of walking the whole table.

## License

Private.

# BNR Licensing & Compliance Portal

A monolith for the National Bank of Rwanda licensing & compliance portal.
Backend (Bun + Hono) implements the application workflow, audit hash chain,
versioned document uploads, and role-gated authorisation. Frontend stays a
SvelteKit shell this iteration — reviewers exercise the API via Scalar at
`/docs`.

```
bnr/
├── backend/    Bun + Hono API + Drizzle + better-auth
├── frontend/   SvelteKit (untouched this iteration)
├── shared/     pure domain types (state machine, enums)
├── docker/     compose stack (postgres + backend)
└── docs/       brief + architecture-thinking + db-architecture + implementation-plan
```

## One-command bring-up

```bash
bun docker:dev
# postgres on :5432, backend on :3001, hot-reload, idempotent migrate + seed
# tear down:  bun docker:dev:down
# nuke:       bun docker:dev:down -v
```

Open the API reference: <http://localhost:3001/docs>.

## Demo flow (Scalar UI or curl)

The dev seed inserts four users (one per role). Password for every user is
`bnr-dev-pass`.

| Email                  | Role       |
| ---------------------- | ---------- |
| `admin@bnr.local`      | admin      |
| `applicant@bnr.local`  | applicant  |
| `reviewer@bnr.local`   | reviewer   |
| `approver@bnr.local`   | approver   |

A full workflow against the running backend:

```bash
BASE=http://localhost:3001

# Sign in (cookies stored in cookies.txt).
curl -c cookies.txt -X POST "$BASE/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -d '{"email":"applicant@bnr.local","password":"bnr-dev-pass"}'

# Create a draft.
APP_ID=$(curl -b cookies.txt -X POST "$BASE/applications" \
  -H 'content-type: application/json' \
  -d '{"institutionName":"Demo Bank","institutionType":"commercial_bank"}' | jq -r .id)

# Upload a document into the business-plan slot.
echo 'pretend pdf' > plan.pdf
curl -b cookies.txt -X POST "$BASE/applications/$APP_ID/documents" \
  -F slot=business-plan -F file=@plan.pdf

# Submit.
curl -b cookies.txt -X POST "$BASE/applications/$APP_ID/transitions" \
  -H 'content-type: application/json' -d '{"event":"submit"}'

# Switch hat: reviewer assigns + RFI + mark_ready.
curl -c cookies.txt -X POST "$BASE/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -d '{"email":"reviewer@bnr.local","password":"bnr-dev-pass"}'

curl -b cookies.txt -X POST "$BASE/applications/$APP_ID/transitions" \
  -H 'content-type: application/json' -d '{"event":"assign"}'

curl -b cookies.txt -X POST "$BASE/applications/$APP_ID/transitions" \
  -H 'content-type: application/json' \
  -d '{"event":"request_info","message":"please attach Q3 ratios"}'

# Approver approves (dual-control: approver != reviewer).
curl -c cookies.txt -X POST "$BASE/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -d '{"email":"approver@bnr.local","password":"bnr-dev-pass"}'

curl -b cookies.txt -X POST "$BASE/applications/$APP_ID/transitions" \
  -H 'content-type: application/json' -d '{"event":"approve"}'

# Admin verifies the chain.
curl -c cookies.txt -X POST "$BASE/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -d '{"email":"admin@bnr.local","password":"bnr-dev-pass"}'

curl -b cookies.txt "$BASE/admin/audit/verify"
# → {"ok":true,"lastVerifiedId":"…","firstBadId":null,"rowsChecked":…}
```

## Tests

```bash
bun --cwd backend test
```

What's covered (one file per concern):

- `state-machine.test.ts` — every edge in the diagram is legal; every
  non-edge returns `illegal_transition`; dual-control + ownership +
  required-message guards all fire.
- `authorisation.test.ts` — table of (role × route) → 200/403. Owners see
  their own, staff see everything, applicants do not 404 on a peer's row
  (they 403, per brief).
- `concurrent-transition.test.ts` — fires two `mark_ready` requests at
  the same `UNDER_REVIEW` row; asserts one 200, one 409, and exactly one
  audit row for the transition.
- `uploads.test.ts` — 5 MiB exact OK; +1 byte 413; unsupported MIME 415;
  byte-identical bytes dedupe in `document_blobs`; re-upload supersedes.
- `audit-chain.test.ts` — verifier returns `ok` on a clean chain;
  tampering with one row's `after_state` flips `firstBadId` to that id.
- `review-notes.test.ts` — staff post + read all visibilities; applicant
  only sees `visibility = 'applicant'`; `request_info` without a message
  returns 422; engine-level grant denies UPDATE/DELETE on `review_notes`.
- `db.test.ts` — schema present, citext + pgcrypto installed, audit-log
  trigger blocks UPDATE even for the superuser.
- `routes.test.ts` — smoke tests on `/`, `/health`, `/openapi.json`, `/docs`.

```
Test Files  8 passed (8)
     Tests  63 passed (63)
```

## What sits where

| Layer        | Path                                  | Role                                                       |
| ------------ | ------------------------------------- | ---------------------------------------------------------- |
| State machine| `shared/src/domain/state-machine.ts`  | pure function; imported by backend + (later) frontend      |
| Errors       | `backend/src/errors.ts`               | domain errors → HTTP mapping (403 not 404, etc.)           |
| Repositories | `backend/src/repositories/*.repo.ts`  | only place that imports `drizzle-orm`                      |
| Services     | `backend/src/services/*.service.ts`   | tx-scoped; calls SM + repos + appends audit                |
| Routes       | `backend/src/routes/*.ts`             | Hono + Zod + describeRoute; one file per resource          |
| Storage      | `backend/src/storage/index.ts`        | tmp/ → sha256-named atomic rename                          |
| Auth         | `backend/src/auth/{index,middleware,policy}.ts` | better-auth + session/role middleware + policy helpers |
| Migrations   | `backend/migrations/{pre,*,post}`     | pre (extensions) → drizzle → post (roles/grants/triggers)  |
| Audit chain  | `backend/src/db/audit-hash.ts`        | canonical JSON + sha256 chain w/ optional pepper           |

## Non-negotiables → enforcement

| # | Requirement                          | Enforcement |
|---|---------------------------------------|-------------|
| 1 | Server-side sessions                  | better-auth + `sessionMiddleware` |
| 2 | Roles with distinct boundaries        | `requireRole` + `policy.ts` |
| 3 | Reviewer ≠ approver (dual control)    | `chk_dual_control` + state-machine guard |
| 4 | Defined state machine                 | `shared/src/domain/state-machine.ts` |
| 5 | Illegal transitions rejected at API   | Service maps SM result → 409/403/422 |
| 6 | Final decision permanent              | Trigger `applications_block_terminal_update` |
| 7 | Concurrent actions safe               | Predicated UPDATE (version + status) → 409 |
| 8 | Append-only audit                     | Grants + trigger + hash chain |
| 9 | Audit columns (actor/action/ts/…)     | `audit_log` schema |
| 10| Documents versioned, 5 MiB cap        | Middleware + stream meter + DB CHECK |
| 11| 403 not 404 on unauthorised           | `errors.ts` + `onError` |
| 12| OpenAPI documented                    | `describeRoute` + same Zod schemas on handlers + at `/docs` |
| 13| Seed: one user per role + apps        | `backend/src/db/seed.ts` |

## What's deliberately not done

- **Frontend wiring.** Per implementation-plan §13: SvelteKit skeleton
  stays untouched this iteration; the API is the deliverable.
- **OAuth, MFA, password reset email.** better-auth supports them, but
  out of scope for the brief.
- **S3 / cloud blob storage.** Documents live on a named Docker volume.
  Path of least resistance: swap `storage/index.ts` for an S3 client; the
  rest of the code paths address blobs by sha256, not by path.
- **Per-suite DB isolation in tests.** One container, one shared DB,
  serial execution (`singleFork: true`). Fast but slightly noisy if a
  test corrupts shared state — `audit-chain.test.ts` carefully restores.
- **PII redaction in audit `before_state`/`after_state`.** Full row
  snapshots are stored; a regulator-grade deployment would scrub PII or
  encrypt those columns at rest.

## What I would do differently with more time

- **Replace bun-specific argon2 with a Node-compatible package.** Today
  we conditionally enable Bun.password and fall back to better-auth's
  default scrypt under Node so vitest runs. A unified hasher across both
  runtimes would simplify the seed → test boundary.
- **Per-test DB schemas.** `pg_dump --schema-only` once, restore per
  test into a uniquely-named schema. Lets parallel test execution turn
  back on without serialisation costs.
- **Audit chain verification at every append.** Currently the verifier
  walks the whole table on demand; appending under load would benefit
  from a cheap incremental check (compare against `prev_hash`).
- **Frontend.** A real applicant + reviewer view that exercises the API
  and renders the state machine's allowed events on each row.
- **Soft-deleting users + retaining audit trail.** Users have
  `disabledAt`, but a full GDPR-style "right to be forgotten" flow needs
  hashing the email + name into the audit rows.

## Documentation

- `docs/Onsite Coding Test Bank Licensing.html` — the brief.
- `docs/BNR Portal — architecture-thinking.html` — stack + trade-offs.
- `docs/BNR Portal — db-architecture.html` — schema + invariants.
- `docs/BNR Portal — implementation plan.html` — what gets built in what order.

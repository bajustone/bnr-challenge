# BNR Licensing & Compliance Portal — design document

> A Senior Software Engineer technical challenge. Read this alongside the two SVG diagrams in [`docs/diagrams/`](./diagrams/). Written 2026-05-11.

This is a single-tenant web portal. A regulated entity applies for a banking licence with the National Bank of Rwanda, BNR staff review the application and decide, and the system produces a tamper-evident record of every action taken along the way.

The brief is short but unforgiving. The system has to be correct under concurrency, safe across roles, immutable after a decision, fully documented, and proven by tests. This document walks through how each of those properties is achieved — the stack, the data model, the request flow, the workflow, the trade-offs — and explains why the obvious alternatives were rejected.

## Table of contents

1. [Problem statement & non-negotiables](#1-problem-statement--non-negotiables)
2. [Stack choices & trade-offs](#2-stack-choices--trade-offs)
3. [System architecture](#3-system-architecture)
4. [Roles & authorisation model](#4-roles--authorisation-model)
5. [Workflow & state machine](#5-workflow--state-machine)
6. [Data model](#6-data-model)
7. [Audit trail & tamper-evidence](#7-audit-trail--tamper-evidence)
8. [Documents & uploads](#8-documents--uploads)
9. [Concurrency & consistency](#9-concurrency--consistency)
10. [API surface & OpenAPI](#10-api-surface--openapi)
11. [Observability & operations](#11-observability--operations)
12. [Testing strategy](#12-testing-strategy)
13. [Security posture](#13-security-posture)
14. [Deployment](#14-deployment)
15. [Trade-offs & what would change with more time](#15-trade-offs--what-would-change-with-more-time)

---

## 1. Problem statement & non-negotiables

The shape of the workflow is straightforward. An applicant submits a licence application with supporting documents. A reviewer reads it, asks for clarifications when needed, and eventually marks it ready for a decision. An approver — who has to be a different person from the reviewer — approves or rejects. An admin manages roles and inspects the audit trail.

What makes this interesting isn't the happy path; it's the properties the system has to hold even when things get adversarial. Here's the full list, with how the design earns each one:

| #   | Property | How the design satisfies it |
|-----|----------|------------------------------|
| N1  | Sessions are server-side, cookies are `HttpOnly` + `SameSite=Lax`. | better-auth with the drizzle adapter; the `session` table has an FK to `users`. |
| N2  | Four roles with distinct boundaries. | `app_role` enum and a `user_roles` join table, enforced by per-route middleware (§4). |
| N3  | Reviewer ≠ approver on the same application. | A pure state-machine guard *and* a Postgres `CHECK` constraint (§5). |
| N4  | The state machine is explicit and single-source-of-truth. | A pure function in `shared/src/domain/state-machine.ts`, importable by both client and server. |
| N5  | Illegal transitions are rejected with 409 — never silently coerced. | The service maps SM errors to typed exceptions; a centralised `onError` handler does the HTTP mapping. |
| N6  | Final decisions are permanent. | Terminal states are sinks in the SM, and a DB trigger blocks any `status` change out of `APPROVED`/`REJECTED`. |
| N7  | Concurrent actions are safe. | Optimistic locking via a predicated `UPDATE … WHERE id = ? AND version = ? AND status = ?`. A zero-row update returns 409. |
| N8  | Append-only audit, legal-grade. | Three independent defence layers: grants, trigger, hash chain (§7). |
| N9  | Every audit row records actor, action, timestamp, before, and after. | `audit_log` columns plus a canonical-JSON snapshot helper used in every mutation. |
| N10 | Documents are uploaded, versioned, capped at 5 MiB. | One slot per document type, a content-addressed blob table, three layers of size enforcement (§8). |
| N11 | 403 (not 404) on unauthorised reads. | Middleware order: auth → role load → policy. 404 only fires when the caller is authorised to know. |
| N12 | Endpoints are documented. | OpenAPI generated inline via `describeRoute`; Scalar served at `/docs`. |
| N13 | The seed is reproducible. | One user per role; six applications across all the non-RFI states; one audit row per seeded transition. |

## 2. Stack choices & trade-offs

### 2.1 Runtime & language: Bun + TypeScript

Bun gives us a single binary that runs TypeScript, an HTTP server, a SQLite shell (which we don't use here), and a test runner. For a small monolith on strict-mode TypeScript, Bun's tooling-as-runtime collapses three install steps (`tsx`, `nodemon`, `typescript`) into zero.

The cost is real, though: some Node-native packages assume specific build APIs, and we hit one of these in `argon2` (it depends on `node-gyp`). We work around it by using `Bun.password` on the runtime path and a `scrypt` fallback when Vitest runs under Node. That asymmetry is the single most painful concession in the project — see §15.

### 2.2 HTTP framework: Hono

Hono won on three properties:

- **Standards-first.** Its request and response objects are Web `fetch` primitives, so the same handler runs on Bun, Cloudflare, Node, or Vercel without rewrites.
- **Validator integration.** Zod schemas double as runtime validators *and* OpenAPI components, through `@hono/standard-validator` plus `describeRoute`. One schema, two purposes, no drift.
- **Tiny middleware surface.** Body limits, CORS, request IDs, session attachment — each one is ten lines of composable middleware.

We considered Elysia, Fastify, and Express. Elysia is excellent on Bun but locks us into a single runtime. Fastify needs a separate OpenAPI plugin and a separate validator. Express is fine for prototypes but predates async-everywhere; the ergonomics of error propagation feel dated.

### 2.3 Database: Postgres 17

The brief asks for tamper-evidence, role-scoped grants, partial indexes for the "only one open application per applicant" rule, and an enum-typed state column. Each of those is one line in Postgres and a hand-rolled enforcement helper in MySQL or SQLite. Postgres 17 specifically gives us:

- `pgcrypto`, for `gen_random_uuid()`.
- `CREATE ROLE` plus `REVOKE UPDATE/DELETE` on the audit table — defence layer 1.
- `ALTER DEFAULT PRIVILEGES`, so new tables inherit the "append-only by default" stance.
- Triggers — defence layer 2, blocking `status` changes out of a terminal state at the DB regardless of caller.
- Partial unique indexes for the "one open application per applicant" rule.

### 2.4 ORM: Drizzle

Drizzle keeps SQL close to the surface, which matters here:

- The schema is TypeScript with first-class type inference. `InferSelectModel<typeof applications>` is what every other layer reads.
- `drizzle-kit` emits real SQL migration files. No opaque "the ORM decides what to migrate" surprises in a regulated environment.
- The query builder is a thin layer over SQL. We can read the generated SQL out loud, which matters when explaining audit guarantees to an auditor.

We considered Prisma. Its migration model is excellent, but the query builder hides SQL behind a DSL we'd then have to translate when talking to reviewers. Drizzle keeps that translation step out of the loop.

### 2.5 Identity: better-auth

Argon2id passwords, server-side sessions in Postgres, drizzle adapter, configurable cookie attributes. Sign-up auto-grants the `applicant` role through a `databaseHooks.user.create.after` callback, so the lowest-privilege role always lands the same way. Staff roles are granted only by an admin.

### 2.6 Frontend: SvelteKit 2 + Svelte 5 runes

The deep workflow UI is out of scope for this iteration (see §15), but the skeleton is in place for the eventual UI: SvelteKit gives us co-located server endpoints (which proxy to the Hono API for auth/cookie reasons), shadcn-svelte components, and Tailwind v4. In this iteration, reviewers exercise the API directly via Scalar at `/docs`.

### 2.7 Container topology: monolith

One backend service, one Postgres, one shared filesystem volume for uploaded blobs. Microservices buy you isolation and bring you distributed-transaction problems; the "write the audit row in the same transaction as the domain change" rule (§7) is much easier to enforce when "the same transaction" actually exists.

## 3. System architecture

![Application architecture diagram](diagrams/app-architecture.svg)

*The request flow: client → edge middleware → per-router auth chain → routes → services → repositories → Postgres + on-disk blobs. Orange arrows are state-mutating paths, and each one writes an audit row in the same transaction.*

### 3.1 Layering

The code is split into four layers, and each layer is allowed to see exactly one thing below it:

| Layer | Responsibility | Sees |
|-------|----------------|------|
| **Routes** (`src/routes/*.ts`) | HTTP shape, Zod parsing, OpenAPI descriptors, status codes. | Services. Never touches Drizzle. |
| **Services** (`src/services/*.service.ts`) | Transaction boundaries, state-machine calls, audit-row append, error mapping. | Repositories + the state machine. Pure domain code, no HTTP. |
| **Repositories** (`src/repositories/*.repo.ts`) | SQL via Drizzle. Predicated updates. Read-modify-write primitives. | The Drizzle handle (pool or transaction). Nothing else. |
| **Shared domain** (`shared/src/domain/*`) | Enums, state machine, transition events. No I/O. | Itself. |

The rule that survives every review pass: **every state-mutating service method runs inside `db.transaction(...)`, and the same transaction writes one `audit_log` row before commit.** Routes don't know about transactions; repositories don't know about audit; services are the only place where both meet.

### 3.2 Why repositories at all?

One argument carries the layer: the "audit-row-in-the-same-tx" rule becomes invisible if route handlers call `db.update()` directly. Putting the predicated update behind a repo method named `transitionWithVersion` makes the call site read like "this should be inside a transaction with an audit append" — and a CI grep can then enforce that `db.update` and `db.insert` never appear outside `src/repositories/`.

### 3.3 Factory functions over classes

Each repo is a factory that takes a Drizzle handle and returns an object of methods. The handle is the pool *or* a transaction — same type either way. Services build the repos they need from `tx` inside `db.transaction`, which means a half-failed mutation can never leave a domain row written without its audit row. Factories also avoid `this`-binding surprises when callers destructure methods, and they tree-shake. No DI container — the dependency graph is three lines.

## 4. Roles & authorisation model

The four roles, and what each one can do:

| Role | Sees | Can mutate |
|------|------|------------|
| `applicant` | Own applications only. | Create / patch (in `DRAFT` or `RFI_REQUESTED`); submit; resubmit; withdraw; upload and replace documents. |
| `reviewer` | All applications. | Assign self; request info (with a message); mark ready for decision; write review notes. |
| `approver` | All applications. | Approve or reject — only if not the same user that reviewed the application. Write review notes. |
| `admin` | All applications, all users, the audit trail. | Grant and revoke roles; query and verify the audit. Cannot bypass the state machine. |

### 4.1 Middleware chain

Every request passes through the same gauntlet, in this fixed order:

```
  request
    │
    ▼  1. requestId       → c.set('requestId', uuid())
    │
    ▼  2. session         → c.set('session', sess | null)   via better-auth getSession
    │
    ▼  3. requireAuth     → 401 if no session
    │
    ▼  4. loadRoles       → c.set('roles', Role[])           one indexed SELECT
    │
    ▼  5. requireRole(R)  → 403 if c.var.roles ∩ R = ∅
    │
    ▼  6. requireVisibility (per-record) → loads the resource, applies owner-or-staff rule
    │
    ▼  7. Zod validator
    │
    ▼  8. handler → service → repos
    │
    ▼  9. onError centralises HTTP mapping
```

### 4.2 403 vs 404

The brief is explicit on this: unauthorised reads must return 403, not 404. Some style guides recommend the opposite (return 404 to hide existence), but the brief overrides them. Order matters here too: auth fires first and produces 401, then policy fires and produces 403, then existence is checked and produces 404 — but only when the actor is authorised to know the resource exists at all.

### 4.3 Per-record policy

An applicant can read their own application; a reviewer, approver, or admin can read any of them. The check is one helper (`requireApplicationVisibility`) that loads the row, compares `applicantId` to `session.userId`, and otherwise checks for a staff role. The same helper gates document reads — documents inherit visibility from their parent application.

## 5. Workflow & state machine

### 5.1 The states

| State | Meaning | Mutable? | Terminal? |
|-------|---------|----------|-----------|
| `DRAFT` | The applicant is filling it in. | Yes — payload and documents. | No |
| `SUBMITTED` | Awaiting reviewer pickup. | No | No |
| `UNDER_REVIEW` | A reviewer has it. | Payload no; review notes only. | No |
| `RFI_REQUESTED` | The reviewer asked for clarification. | Yes — payload and documents. | No |
| `READY_FOR_DECISION` | The reviewer says it's complete. | No; awaiting an approver. | No |
| `APPROVED` | Licence granted. | No | **Yes** |
| `REJECTED` | Licence refused. | No | **Yes** |
| `WITHDRAWN` | The applicant pulled it. | No | **Yes** |

### 5.2 The transitions

```
                 ┌────────── (applicant) withdraw ──────────────► WITHDRAWN
                 │
                 │                                         (applicant) withdraw
                 │                                              ▲
   DRAFT ── submit ──► SUBMITTED ── assign ──► UNDER_REVIEW ───┤
     ▲                                            │            │
     │                                            ├── request_info ──► RFI_REQUESTED
     │                                            │                       │
     │                                            │                       │ resubmit
     │                                            │                       ▼
     │                                            │                    SUBMITTED
     │                                            │                       │
     │                                            └── mark_ready ──► READY_FOR_DECISION
     │                                                                    │
     │                                                                    ├── (approver≠reviewer) approve ──► APPROVED  (terminal)
     │                                                                    └── (approver≠reviewer) reject  ──► REJECTED  (terminal)
     │
     (applicant cannot return from SUBMITTED/UNDER_REVIEW directly — RFI is the channel)
```

### 5.3 The pure function

The signature is exhaustive on event tags:

```ts
type TransitionInput = {
  currentStatus: ApplicationStatus;
  event: TransitionEvent;        // 'submit' | 'assign' | 'mark_ready' | 'request_info' | 'resubmit' | 'approve' | 'reject' | 'withdraw'
  actor: { id: string; roles: Role[] };
  application: { applicantId: string; reviewedBy: string | null; decidedBy: string | null };
  message?: string;              // required for request_info
};

type TransitionResult =
  | { ok: true;  nextStatus: ApplicationStatus; patch: TransitionPatch; eventName: string }
  | { ok: false; reason: 'illegal_transition'
                       | 'forbidden_role'
                       | 'dual_control_violation'
                       | 'not_owner'
                       | 'missing_rfi_message' };
```

It runs three checks in a fixed order, and each one lives — and is tested — in exactly one place:

1. **Legal edge.** The `(currentStatus, event)` pair has to be on the diagram above.
2. **Role guard.** The actor must hold the role that owns this edge.
3. **Dual control.** If `event ∈ {approve, reject}`, refuse when `actor.id === application.reviewedBy`.

The function is pure and lives in `shared/`, so the frontend can render exactly the buttons the backend would accept — no "submit" button showing on a row that's in `UNDER_REVIEW`.

### 5.4 Why a pure function, and not XState

XState is excellent when states have side effects, sub-machines, or parallel regions. Ours doesn't — it's a flat directed graph with role guards. A pure function with a `switch` is shorter, faster, trivially testable, and easy to explain to an auditor. The cost (no built-in visualiser) is paid by the diagram above and the SVG in `docs/diagrams/`.

## 6. Data model

![Database architecture diagram](diagrams/db-architecture.svg)

*Schema overview: nine tables, the FK web between them, the append-only zones (`audit_log` and `review_notes`), and the partial unique index that enforces "one open application per applicant."*

### 6.1 Tables

| Table | Role | Key invariants |
|-------|------|----------------|
| `users` | better-auth identity rows. | One `email`; the hash is never returned to the client. |
| `session`, `account`, `verification` | better-auth internals. | Owned by the library; we don't write to them directly. |
| `user_roles` | Many-to-many `users` × `app_role`. | One row per `(user_id, role)`; admin-only INSERT/DELETE outside the seed. |
| `applications` | The licence application itself. | `version` increments on every state change; `status` is an enum; `reviewedBy` and `decidedBy` populated lazily by the SM patch. |
| `documents` | Per-slot version metadata. | Unique `(application_id, slot, version)`; `superseded_at` marks old versions. |
| `document_blobs` | Content-addressed file rows. | PK is the `sha256`; size enforced by `CHECK (size_bytes <= 5*1024*1024)`. |
| `review_notes` | Append-only staff commentary, carries RFI messages. | Insert-only via grants; visibility filter applied at the read path. |
| `audit_log` | Tamper-evident hash chain. | Three-layer defence (§7); no UPDATE/DELETE on `app_user`. |

### 6.2 Invariants the database enforces directly

Some rules the application can't be trusted to enforce alone, so they live in the schema:

- `chk_dual_control` on `applications` — `decided_by IS NULL OR decided_by <> reviewed_by`. Belt to the SM's braces.
- `chk_terminal_immutable` trigger — refuses any `UPDATE applications` when `OLD.status IN ('APPROVED','REJECTED','WITHDRAWN')` and any column other than `updated_at` changes.
- `uniq_open_application_per_applicant` — a partial unique index on `applicant_id WHERE status NOT IN ('APPROVED','REJECTED','WITHDRAWN')`.
- `chk_blob_size` — `size_bytes <= 5 * 1024 * 1024`. The last line of defence, after the two app-level size checks.
- `chk_visibility` on `review_notes` — `visibility IN ('staff','applicant')`, and `body` length between 1 and 10000.

### 6.3 Why content-addressing for blobs

Two applicants who upload the same PDF — a regulator template, for example — store one blob and two metadata rows. The `sha256` is both the integrity check (re-hash to verify) and the dedup key. The cost is one extra table; the win is that the blob row never needs an UPDATE — new content gets a new row.

### 6.4 Versioning model for documents

Each *slot* (`business-plan`, `memo-articles`, `capital-proof`, and so on) on each application holds an ordered list of versions. When someone re-uploads to the same slot, the previous current version gets `superseded_at = now()`, and the new row is created at `version + 1`. The reviewer always reads "current" by default; the audit history exposes "all." That gives us "documents can be replaced before submission" without ever deleting a row.

## 7. Audit trail & tamper-evidence

The brief calls for a legal-grade audit. We use three independent layers, and *all of them* would have to fail simultaneously for tampering to go undetected.

### 7.1 Layer 1 — Postgres grants

The application connects as `app_user`, which has `SELECT, INSERT` on `audit_log` and **no** `UPDATE`, `DELETE`, or `TRUNCATE`. An attacker holding the runtime DB credentials cannot edit history. `ALTER DEFAULT PRIVILEGES` sets this as the standing default, so new append-only tables (like `review_notes`) get the same treatment automatically.

### 7.2 Layer 2 — Postgres trigger

A `BEFORE UPDATE OR DELETE` trigger on `audit_log` raises `'audit_log_is_append_only'`. Even a misconfigured grant or a future migration that accidentally loosens privileges can't get past this — the trigger has to be explicitly removed.

### 7.3 Layer 3 — hash chain

```
  row[i].row_hash = sha256( row[i-1].row_hash || canonical_json(row[i]) || pepper )

  - row[0].prev_hash = GENESIS (32 zero bytes)
  - canonical_json: stable key order, no whitespace, BigInt → decimal string
  - pepper: AUDIT_HASH_SECRET env var (optional; if set in prod, required at verify time)
```

Each insert is computed in the same transaction as the domain mutation. The `recordAuditEvent` helper takes a transaction handle, locks the latest row with `SELECT … FOR UPDATE`, computes the next `row_hash` from the now-known `prev_hash`, and inserts. Concurrent transactions queue on the lock — chain forks are impossible.

### 7.4 Verification

`GET /admin/audit/verify` walks the table by `id`, replaying the chain. It returns `{ ok, lastVerifiedId, firstBadId, rowsChecked }`. Tampering with any column flips `row_hash`; truncation flips `prev_hash`. Pepper rotation can be done by re-hashing offline and replacing; the verifier compares against whichever pepper is currently configured.

### 7.5 What's snapshotted

`before_state` and `after_state` hold the canonical full row, not a diff. Diffs are convenient until they aren't — replaying a deletion needs the whole row. PII concerns in a regulator-grade deployment would scrub or encrypt these columns; we haven't done that here (see §15).

## 8. Documents & uploads

### 8.1 The pipeline

```
POST /applications/:id/documents       multipart/form-data: slot, file
        │
        ▼
1. Hono body-limit middleware ────► 413 if Content-Length > 5 * 1024 * 1024
        │
        ▼
2. Parse multipart, stream `file`:
     - open  $STORAGE_DIR/tmp/<uuid>.part   (mode 0600)
     - tee bytes to file + streaming sha256 hasher
     - if bytesWritten > 5 MiB → abort, unlink, 413   (catches lying CL)
     - on EOF: finalSize, finalSha256
        │
        ▼
3. db.transaction:
     a) authz: actor.id === application.applicant_id AND status ∈ {DRAFT, RFI_REQUESTED}
     b) upsert document_blobs (sha256, sizeBytes, storagePath)
          - INSERT … ON CONFLICT (sha256) DO NOTHING
          - if conflict: unlink the tmp file, reuse existing blob (size matches by PK)
          - if insert:   mkdir -p $STORAGE_DIR/<sha[0:2]> ; rename tmp → final
     c) nextVersion = (SELECT COALESCE(MAX(version), 0) + 1
                       FROM documents WHERE application_id = ? AND slot = ?)
     d) UPDATE documents SET superseded_at = now()
          WHERE application_id = ? AND slot = ? AND superseded_at IS NULL
     e) INSERT documents (id, application_id, slot, version, mime, original_filename, blob_sha256)
     f) recordAuditEvent(action='document.uploaded', after_state={slot, version, sha256})
        │
        ▼
4. 201 Created  { id, slot, version, sizeBytes, sha256 }
```

### 8.2 Three layers of size enforcement

The 5 MiB cap is enforced in three places, in order:

1. **Body-limit middleware** — rejects based on the declared `Content-Length` before reading bytes.
2. **Stream counter** — catches a client lying about `Content-Length`, aborting before 5 MiB of dishonest data lands on disk.
3. **DB `CHECK` constraint** — the last line, defending against any future bug that bypasses the first two.

### 8.3 Why upsert-blob before the rename

The DB row is the source of truth for "does this blob exist?" If we renamed the file first and inserted the row later, a crash in between would leave orphan files. The order we use means a crash at most leaves a `tmp/<uuid>.part` file — a cron job clears anything older than an hour.

### 8.4 Why a named volume over a bind mount

A bind mount to `./storage` leaks host UIDs and GIDs into the container, which produces "permission denied" surprises on Linux hosts. A named volume is owned by the container user inside Docker's storage area. Reviewers can inspect it with `docker run --rm -v bnr_storage:/x alpine ls -R /x`. In production the same volume name either maps to a bind mount under a backed-up directory, or is declared `external: true`.

### 8.5 MIME allow-list

We use an allow-list at the API boundary (a Zod enum: PDF, PNG, JPEG, WebP, DOCX, XLSX) plus a magic-byte sniff on the first 512 bytes of the stream. Anything else returns 415. We store both the declared and the sniffed MIME, so a divergence becomes its own audit event.

## 9. Concurrency & consistency

The scenario worth thinking through: two reviewers refresh the same application a second apart, and they both click "mark ready." We must allow exactly one of them to win.

### 9.1 Optimistic locking with a predicated UPDATE

```sql
UPDATE applications
   SET status = 'READY_FOR_DECISION',
       version = version + 1,
       reviewed_by = $reviewer_id,
       updated_at = now()
 WHERE id = $id
   AND version = $expected_version
   AND status = $expected_status
RETURNING *;
```

Zero rows back means another writer beat us. The repo returns `null`, the service raises `ConcurrentUpdateError`, and the handler returns 409 with the hint `"refresh and retry"`. We don't retry on the server — the user needs to re-read because the world changed under them.

### 9.2 The audit row inside the same transaction

The audit append uses `SELECT id, row_hash FROM audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE` to serialise. A losing concurrent transition that returns 0 from the predicated update rolls back the whole transaction: nothing in `audit_log`, nothing in `applications`, no half-state. The concurrency test asserts that exactly *one* audit row exists after the race.

### 9.3 Isolation level

The default `READ COMMITTED` is enough, thanks to the predicated `WHERE version = ?`. We don't need `SERIALIZABLE`; the optimistic check makes the conflict visible as a zero-row update rather than a serialization failure.

## 10. API surface & OpenAPI

| Method & path | Who | What |
|---------------|-----|------|
| `POST /auth/sign-up/email` | public | Create user; auto-grant the `applicant` role. |
| `POST /auth/sign-in/email` | public | `HttpOnly` cookie session. |
| `POST /auth/sign-out` | session | Delete the session row. |
| `GET  /me` | session | `{ user, roles }`. |
| `POST /applications` | applicant | Create a DRAFT. |
| `GET  /applications` | any role | Scoped by role. |
| `GET  /applications/:id` | owner \| staff | 403 if hidden, 404 if missing. |
| `PATCH /applications/:id` | owner | Edit payload (DRAFT or RFI_REQUESTED only). |
| `POST /applications/:id/transitions` | role-dependent | The single mutation endpoint for the SM. Body: `{ event, message?, reason? }`. |
| `POST /applications/:id/documents` | owner | Multipart upload. |
| `GET  /applications/:id/documents` | owner \| staff | `?include=current\|all`. |
| `GET  /documents/:id` | owner \| staff | Metadata. |
| `GET  /documents/:id/content` | owner \| staff | Streams the blob; logs `document.downloaded`. |
| `GET  /applications/:id/history` | owner \| staff | The audit rows for this resource. |
| `GET  /applications/:id/notes` | owner (applicant-visibility only) \| staff (all) | Review notes. |
| `POST /applications/:id/notes` | staff | Append a note: `{ visibility, body }`. |
| `GET  /admin/users` | admin | List users with their roles. |
| `POST /admin/users/:id/roles` | admin | Grant a role. |
| `DELETE /admin/users/:id/roles/:role` | admin | Revoke a role. |
| `GET  /admin/audit` | admin | Filter by resource or actor; paginated. |
| `GET  /admin/audit/verify` | admin | Walk the chain; returns `{ ok, lastVerifiedId, firstBadId, rowsChecked }`. |

### 10.1 Single mutation endpoint per workflow

One `POST /applications/:id/transitions` instead of `/submit`, `/approve`, `/reject`, and so on. The `event` in the body discriminates, and the server enforces the state machine. This keeps the API one route smaller, the OpenAPI document one schema cleaner, and the access table one column thinner. The trade-off is that introspecting "what can I do next?" requires reading `/me` plus the SM diagram — but we solve that on the client by importing the same shared function.

### 10.2 OpenAPI policy

Every route has an inline `describeRoute` with its request schema, response schema, tags, and a summary. The Zod schemas used to validate are the same ones the OpenAPI generator references — they cannot drift. Scalar at `/docs` renders from `/openapi.json`; reviewers don't need Postman.

### 10.3 Error mapping

| Domain error | HTTP | Body |
|--------------|------|------|
| `UnauthorizedError` | 401 | `{ error: 'unauthenticated', requestId }` |
| `ForbiddenError` | **403** | `{ error: 'forbidden', requestId }` |
| `NotFoundError` | 404 | `{ error: 'not_found', requestId }` |
| `ValidationError` | 422 | `{ error: 'invalid', issues, requestId }` |
| `IllegalTransitionError` | 409 | `{ error: 'illegal_transition', from, event, requestId }` |
| `ConcurrentUpdateError` | 409 | `{ error: 'conflict', hint: 'refresh and retry', requestId }` |
| `PayloadTooLargeError` | 413 | `{ error: 'too_large', maxBytes, requestId }` |
| `UnsupportedMediaTypeError` | 415 | `{ error: 'unsupported_media_type', allowed, requestId }` |
| Anything uncaught | 500 | `{ error: 'internal', requestId }` — stack to logs only |

## 11. Observability & operations

- **Structured logs.** pino, one JSON line per request: `{ requestId, method, path, status, durationMs, actorId? }`. The `x-request-id` header is echoed back so users can quote it. pino-pretty in dev, JSON in prod, silent under Vitest.
- **Redaction tripwire.** `password`, `token`, `cookie`, and `authorization` are in pino's `redact` list. They should never reach the logger in the first place — redaction is the tripwire that catches the day they do.
- **Drizzle query log.** Wired at `debug`, so it's silent in prod unless you dial `LOG_LEVEL` up.
- **The durable record is the audit table.** Logs are for humans debugging the moment; `audit_log` is for regulators reconstructing the day.
- **Health.** `GET /health` returns `{ ok, db: 'up' }` after a `SELECT 1` round-trip.
- **Migrations on startup.** The dev container's entrypoint runs pre + drizzle + post migrations idempotently, then seeds. Production would split these into a one-shot migration job.

## 12. Testing strategy

Vitest, run inside the backend workspace. `tests/global-setup.ts` spins up a per-suite testcontainers Postgres and runs the full migration + grant + trigger stack, so every test sees the real schema. Execution is serial (`singleFork: true`) to keep the schema simple; per-test schema isolation is on the "would do with more time" list.

| Suite | What it proves |
|-------|----------------|
| `state-machine.test.ts` | Every legal edge; non-edges return `illegal_transition`; dual-control fires; RFI message required; ownership; terminal states reject every event. |
| `authorisation.test.ts` | Table-driven: (role × route) → 200 or 403. Applicant gets 403 on peer applications. Admin can list users; reviewer cannot. |
| `concurrent-transition.test.ts` | Two simultaneous `mark_ready` calls → exactly one 200, one 409, one audit row. |
| `uploads.test.ts` | 5 MiB exact OK; +1 byte 413; lying `Content-Length` still rejected; sha256 dedup; slot versioning. |
| `audit-chain.test.ts` | Clean chain verifies; tampered `after_state` flips `firstBadId`; pepper change makes the whole chain fail. |
| `review-notes.test.ts` | Visibility filter works; applicant gets 403 on POST; missing RFI message returns 422; grant denies UPDATE on the table. |
| `auth-routes.test.ts` | Sign-up → sign-in → /me → sign-out cookie round-trip; OpenAPI cookie-auth security scheme present. |
| `cors.test.ts` | Preflight works; allow-origin echoed for listed origins; unlisted origin rejected. |
| `db.test.ts` | Schema, extensions, audit trigger all present. |
| `routes.test.ts` | `/`, `/health`, `/openapi.json`, `/docs` smoke. |

The concurrency test is the one a reviewer should read first. It's around 40 lines, and the assertion that "exactly one audit row exists after the race" is the load-bearing part — that *is* the brief's "no inconsistent state" requirement translated into executable code.

## 13. Security posture

- **Passwords.** argon2id via `Bun.password` in the runtime, scrypt fallback when Vitest runs under Node. The hash never leaves the DB row.
- **Cookies.** better-auth defaults: `HttpOnly` + `SameSite=Lax`, plus `Secure` in prod. CSRF is mitigated by Lax + a same-origin frontend, with no token dance to maintain.
- **CORS.** `ALLOWED_ORIGINS` feeds both the CORS middleware and better-auth's `trustedOrigins`. Wildcard origins are never enabled. Credentials are echoed only for listed origins.
- **SQL injection.** Drizzle parameterises every query; there's no string concatenation. Raw SQL only appears in migrations, which are developer-owned.
- **Two DB roles.** `app_user` for the running service (no UPDATE/DELETE on `audit_log`), `app_owner` for migrations and seed only. Mixing them in one connection pool is impossible — they're separate env vars.
- **Mass assignment.** Every input is a Zod schema, with `strict()` enums forbidding unknown fields. The PATCH endpoint allow-lists exactly the editable columns.
- **File uploads.** See §8 — three-layer size cap, MIME allow-list, sniff verification, atomic rename.
- **PII.** Logs redact `password`, `token`, `cookie`, and `authorization`. Audit snapshots, however, are *not* currently scrubbed of PII — a regulator-grade deployment would encrypt or column-mask them.

## 14. Deployment

### 14.1 One-command bring-up

```bash
bun install
bun docker:dev            # postgres :5432, backend :3001, hot reload
                          # entrypoint runs migrate + seed idempotently
bun --cwd frontend dev    # http://localhost:5173
```

### 14.2 Compose layout

The Compose configuration is split across a few files so each environment can layer on the base:

- `docker/compose.yaml` — the base. Names the volumes (`pg_data`, `bnr_storage`) and the two services.
- `compose.dev.yaml` — hot reload, bind-mounts the source, exposes ports.
- `compose.staging.yaml` / `compose.prod.yaml` — overlays that fix the image tag, set restart policies, and declare external volumes.

### 14.3 Environment variables

| Variable | Where | Default | Notes |
|----------|-------|---------|-------|
| `DATABASE_URL` | backend | — | `app_user` connection; no UPDATE/DELETE on audit. |
| `DATABASE_OWNER_URL` | migrate + seed | — | `app_owner`; never used by the running server. |
| `AUDIT_HASH_SECRET` | backend | (none) | Optional pepper; if set, must match at verify time. |
| `STORAGE_DIR` | backend | `./storage` | Compose overrides to `/var/lib/bnr/storage`. |
| `ALLOWED_ORIGINS` | backend | `http://localhost:{5173,3001}` | CORS + better-auth. |
| `LOG_LEVEL` | backend | `debug` in dev, `info` in prod | pino level. |

### 14.4 Backup & restore

Out of scope for this iteration, but the design supports the obvious story: `pg_dump` for the schema and chain, `tar` of `$STORAGE_DIR` for the blobs. Because the blob filename *is* the sha256, a restore can verify itself — walk `document_blobs`, re-hash each file, and fail loudly on any mismatch.

## 15. Trade-offs & what would change with more time

### 15.1 Conscious omissions

These are things we deliberately didn't build, with notes on what it would take to add them later:

- **S3 / cloud blob storage.** Disk is fine for a take-home; production swaps `backend/src/storage/index.ts` for an S3 driver. Addressing stays by sha256, so the schema doesn't move.
- **OAuth / MFA / email verification.** better-auth supports all of them; out of scope for the brief. Adding them is a config change, not a refactor.
- **Per-test schema isolation.** One container, one shared DB, serial execution (`singleFork: true`), carefully restored where any test mutates shared state. A per-test schema would let us re-enable parallel execution and roughly halve suite time.
- **PII redaction in audit snapshots.** Full row snapshots in `before_state`/`after_state`. A regulator-grade deployment would scrub or column-encrypt these.
- **Frontend feature parity.** The SvelteKit skeleton has the login gate and routing scaffold; reviewer and approver flows are exercised via the API and Scalar in this iteration.
- **Incremental audit verification.** The verifier walks the entire chain. At our scale (hundreds of rows) that's fine; at thousands or millions per day, we'd verify-on-append and store the last good `id` alongside a long-tail full walk on a schedule.

### 15.2 What I would do differently

- **A unified password hasher.** The Bun/Node split (`Bun.password` in runtime, scrypt in Vitest) is the single ugliest concession in the codebase. A Node-native argon2 package used in both would close it.
- **Per-test schema, parallel tests.** See above — it cuts suite time and eliminates "did the previous test leave state?" investigations.
- **Reviewer and approver UI.** The SvelteKit skeleton is wired; building the workflow views is a week of iteration, not an architectural shift.
- **Incremental audit-chain verification.** Verify-on-append, do the full walk on a schedule, expose the last good id in `/health` for a monitoring probe.
- **Outbound webhooks.** An audit-row append could fire a queued webhook to a downstream system of record (the BNR core register). Not in scope, but the audit-row hook is the natural insertion point.

---

*Read alongside: [`diagrams/app-architecture.svg`](./diagrams/app-architecture.svg) (request flow) and [`diagrams/db-architecture.svg`](./diagrams/db-architecture.svg) (schema + invariants). Design document, 2026-05-11.*

# BNR Licensing & Compliance Portal — design notes

A single-tenant portal: applicants submit licence applications, reviewers review, approvers decide, admins inspect a tamper-evident audit trail.

API docs (Scalar, served by the backend): <http://localhost:3001/docs>.

Read alongside the SVGs in [`docs/diagrams/`](./diagrams/).

## Why this tech stack

It's a solo build, so I optimised for **one language end to end and a small set of moving parts**. If this were a team project I'd let the team's familiarity drive the choice instead — what's below is what works best for me solo, not a universal recommendation.

### Monolith, TypeScript everywhere

One repo, one language, one type system shared between `backend/`, `frontend/`, and `shared/`. The state machine in `shared/` is imported by both sides, so the UI only renders actions the backend would accept. No service mesh, no schema sync chore, no context switching.

### Hono + Zod + OpenAPI

- **Hono** is built on Web `fetch` primitives — request and response are standards-based, so handlers are portable across Bun, Node, Cloudflare. Performance is solid and the middleware surface is tiny.
- **Zod** schemas double as runtime validators *and* OpenAPI components. One schema, no drift.
- **OpenAPI** is generated inline via `describeRoute`; Scalar renders it at `/docs`. Reviewers don't need Postman.

### Postgres 17

Most invariants belong at the data layer where the application can't lie about them:

- `CHECK` constraints for dual control (reviewer ≠ approver) and blob size
- Partial unique index for "one open application per applicant"
- Triggers to freeze terminal states and make `audit_log` append-only
- Two DB roles — `app_user` (runtime, no UPDATE/DELETE on audit) and `app_owner` (migrations only) — so a misbehaving handler physically cannot rewrite history

### Drizzle

TypeScript schema with real inferred types, real SQL migration files (no opaque ORM magic). Reads close to the SQL it generates, which matters when explaining audit guarantees.

### better-auth

Server-side sessions in Postgres, HttpOnly + SameSite=Lax cookies, Argon2id, drizzle adapter. Self-signup auto-grants the `applicant` role via a database hook; staff roles only come from an admin grant.

### SvelteKit + Svelte 5

SSR like Next.js, but a much smaller JS bundle shipped to the browser. Runes (`$state`, `$derived`, `$effect`) keep reactivity explicit. The browser never calls the backend directly — every request flows through SvelteKit server hooks, so the session cookie stays HttpOnly and CSRF is handled by better-auth's origin check.

## How the pieces fit

![Application architecture](diagrams/app-architecture.svg)
![Database architecture](diagrams/db-architecture.svg)

### Layers

| Layer | Job |
|-------|-----|
| Routes | HTTP shape, Zod parse, OpenAPI descriptors |
| Services | Transaction boundary, state-machine call, audit append |
| Repositories | SQL via Drizzle, predicated updates |
| Shared domain | Enums, state machine, pure functions, no I/O |

The rule: every state-mutating service runs inside `db.transaction(...)` and writes one `audit_log` row in the same transaction.

### State machine

`DRAFT → SUBMITTED → UNDER_REVIEW → READY_FOR_DECISION → APPROVED | REJECTED`, with `RFI_REQUESTED` as the clarification loop and `WITHDRAWN` as the applicant escape hatch. Approve/reject refuse when `actor.id === reviewedBy` (dual control). A pure function in `shared/` that both sides import.

### Audit trail

Three independent layers:

1. **Grants** — `app_user` only has SELECT and INSERT on `audit_log`.
2. **Trigger** — `BEFORE UPDATE OR DELETE` raises.
3. **Hash chain** — `row_hash = sha256(prev_hash || canonical_json(row) || pepper)`. `GET /admin/audit/verify` walks the chain.

All three would have to fail at once for tampering to go undetected.

### Concurrency

Optimistic locking with a predicated update:

```sql
UPDATE applications SET ... WHERE id = ? AND version = ? AND status = ?;
```

Zero rows → 409 with `"refresh and retry"`. The audit insert uses `SELECT ... FOR UPDATE` on the chain tail, so concurrent transactions serialise and chain forks are impossible.

### Documents

Content-addressed by sha256, one slot per document type, 5 MiB cap enforced in three places (body-limit middleware, streaming counter, DB `CHECK`). Re-uploads supersede rather than delete.

## Trade-offs

- **Conscious omissions.** S3 storage (swap `backend/src/storage/index.ts`), OAuth/MFA (better-auth supports both), per-test DB isolation (currently one shared testcontainer, serial), PII redaction in audit snapshots.
- **The Bun/Node password-hasher split.** `Bun.password` at runtime, scrypt in Vitest. The single ugliest concession — a unified hasher would close it.
- **Frontend feature parity.** Login + scaffolding are wired; the reviewer/approver UIs aren't built out yet. Workflow is exercised via the API at `/docs`.

If this were a team project I'd revisit the runtime choice (Bun is fast but still rough around some Node packages), and probably swap the disk-backed blob store for S3 from day one.

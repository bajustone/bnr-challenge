# BNR Licensing & Compliance Portal

Licensing portal for the National Bank of Rwanda. Applicants submit, reviewers review, approvers decide, admins audit. Monolith, one repo.

## Layout

- `backend/` — Bun + Hono + Drizzle + Postgres 17 + better-auth
- `frontend/` — SvelteKit 2 + Svelte 5 + Tailwind v4
- `shared/` — state machine and domain types, imported by both
- `docker/` — Compose files
- `docs/` — [design.md](./docs/design.md) and diagrams

## Run it

```bash
bun install
bun docker:dev               # postgres :5432, backend :3001
bun --cwd frontend dev       # http://localhost:5173
```

- API docs (Scalar): <http://localhost:3001/docs>
- Frontend: <http://localhost:5173>

Stop with `bun docker:dev:down` (add `-v` to wipe data).

## Dev credentials

Seeded users, password `bnr-dev-pass`:

| Email | Role |
|-------|------|
| `applicant@bnr.local` | applicant |
| `reviewer@bnr.local` | reviewer |
| `approver@bnr.local` | approver |
| `admin@bnr.local` | admin |

## Tests

```bash
bun --cwd backend test
```

The suite covers the state machine (valid + invalid transitions, dual control, ownership), role authorisation per route, the concurrent-transition requirement (`tests/concurrent-transition.test.ts`), the audit hash chain (`tests/audit-chain.test.ts`), upload limits + versioning, and the auth + CORS surface.

## Audit verification

The audit log is a hash chain. Sign in as `admin@bnr.local` and either:

- visit `/admin` (the dashboard reports chain status), or
- hit the API directly: `GET http://localhost:3001/admin/audit/verify`

The response is `{ ok, lastVerifiedId, firstBadId, rowsChecked }` — `ok: false` with a `firstBadId` means the chain broke at that row.

## Limitations / known trade-offs

Full list in [`docs/design.md#trade-offs`](./docs/design.md). The short version:

- **Password hasher split.** `Bun.password` (argon2id) at runtime; scrypt in Vitest because Bun's hasher isn't available inside Node-based test workers. The single ugliest concession.
- **Disk-backed blob storage.** Content-addressed under `backend/storage/`. The interface in `backend/src/storage/index.ts` is the swap point for S3.
- **One shared testcontainer, serial.** Cheaper than a per-test database; the suite doesn't share fixtures across tests so the cost is interleaved runtime, not correctness.
- **No notification channel.** Applicants see RFI messages on next page load, not via email/push.
- **Admin is break-glass.** Admins can perform any state transition; dual control still applies to approve/reject.


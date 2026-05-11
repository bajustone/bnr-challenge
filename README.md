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

# Bank Licensing & Compliance Portal (BNR)

Monolith repository for the National Bank of Rwanda licensing & compliance portal.

```
bnr/
├── backend/    # Bun + Hono API
├── frontend/   # SvelteKit web UI
└── docs/       # Challenge brief & design documents
```

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3

## Install

```bash
bun install                 # installs root workspace
bun --cwd backend install
bun --cwd frontend install
```

## Run

In two terminals:

```bash
bun run dev:backend    # http://localhost:3001
bun run dev:frontend   # http://localhost:5173 — proxies /api → backend
```

Or both at once (workspace filter):

```bash
bun run dev
```

## Layout

- **backend/** — bare Bun runtime serving a Hono app. Entry: `backend/src/index.ts`.
- **frontend/** — bare SvelteKit (minimal template, TypeScript, no add-ons). Vite dev server proxies `/api/*` to the backend.

## Status

Scaffolding only. The implementation of authentication, the application state machine, the audit log, document handling, and the design document follows in subsequent commits per the challenge brief in `docs/`.

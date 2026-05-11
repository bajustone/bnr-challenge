# bnr-frontend

SvelteKit 2 + Svelte 5 (runes) + Tailwind v4 + shadcn-svelte.

The browser never talks to the backend directly — every request goes through SvelteKit server hooks / actions / `load`. Session cookies stay HttpOnly.

## Run

```bash
bun --cwd frontend dev       # http://localhost:5173
```

Backend must be up (`bun docker:dev` from the repo root). API docs at <http://localhost:3001/docs>.

Sign in with any [seeded user](../README.md#dev-credentials), password `bnr-dev-pass`.

## Scripts

| Script | What it does |
|--------|--------------|
| `bun run dev` | Vite dev server |
| `bun run check` | `svelte-check` |
| `bun run build` | Production build (Node adapter, SSR) |

## Env

```env
BACKEND_URL=http://localhost:3001
```

## Conventions

- Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`)
- Data loaded in `+page.server.ts`, not the browser
- Import the state machine from `bnr-shared` so the UI only renders actions the backend would accept
- Add shadcn primitives with `bunx shadcn-svelte@latest add <name> -y`

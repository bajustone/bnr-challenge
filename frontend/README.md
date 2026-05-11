# bnr-frontend

SvelteKit 2 + Svelte 5 (runes) + Tailwind v4 + [shadcn-svelte](https://www.shadcn-svelte.com/) for the BNR Licensing Portal.

Setup-only scaffold — see `docs/frontend-setup-plan.html` for what is in this commit and what is deliberately deferred (auth screens, API client, applications views).

## Run

```sh
# from the repo root
bun install

# dev server on http://localhost:5173 with /api proxied to the backend
cd frontend && bun run dev

# type-check
bun run check

# production build
bun run build
```

`vite.config.ts` proxies `/api/*` to `http://localhost:3001` by default; override with `BACKEND_URL=…`.

## Design system

shadcn-svelte components are **vendored** under `src/lib/components/ui/`. They are part of our source code — edit them freely. The registry's CLI is used only to scaffold new ones.

To add a component:

```sh
cd frontend
bunx shadcn-svelte@latest add <name> -y
```

The CLI reads `components.json`, drops the files under the configured alias (`$lib/components/ui/<name>/`), and installs any peer deps (`bits-ui`, additional `@lucide/svelte` icons, etc.).

Currently vendored: `alert`, `badge`, `button`, `card`, `input`, `label`, `separator`, `skeleton`, `sonner`.

## Conventions

- **Svelte 5 runes** — `$state`, `$derived`, `$effect`, `$props`. No `svelte/store` imports unless a third-party API forces it.
- **Server-first data loading** — once feature work begins, data comes through `+page.server.ts` `load` functions that call the backend via the Vite proxy. Client-side `fetch` only when there's a reason (uploads, polling, optimistic UI).
- **Shared types from `bnr-shared`** — state machine, transition events, role enum, application status enum. Render only what the backend would accept.
- **Path aliases over relative climbs.** Anything two `..` deep gets aliased via `svelte.config.js` / `components.json`.
- **Errors as UI.** The backend's error shape (`{ error, requestId, … }`, see implementation plan §7.3) maps to an `<Alert>` for inline failures and a `sonner` toast for transient ones.
- **403 vs 404.** Trust the backend's status codes; render distinct screens. Never hide a 403 as a 404.

## Dark mode

`mode-watcher` injects an inline class on `<html>` synchronously to avoid FOUC. The toggle on the landing page calls `toggleMode()`; preference is persisted in `localStorage` and falls back to `prefers-color-scheme`.

## What's next

Feature work follows in subsequent commits, each one bringing in only the primitives (`dialog`, `sheet`, `dropdown-menu`, `table`, `form`, `select`, …) that the screen it ships actually uses. See `docs/BNR Portal — implementation plan.html` §11 for the backend phase order; the frontend tracks alongside it once auth and the applications API are live.

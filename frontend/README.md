# bnr-frontend

SvelteKit 2 · Svelte 5 (runes) · Tailwind v4 · [shadcn-svelte](https://www.shadcn-svelte.com/).

Server-rendered, cookie-authenticated UI for the BNR Licensing Portal. The frontend never talks to the backend from the browser — every request goes through SvelteKit server-side hooks + actions + load functions, so the session cookie stays HttpOnly and CSRF is enforced by better-auth's origin check on the backend.

## Quick start

```bash
# from the repo root
bun install
bun docker:dev                  # bring up postgres + backend (other terminal)
bun --cwd frontend dev          # http://localhost:5173
```

Sign in with any of the [seeded users](../README.md#dev-credentials) — password `bnr-dev-pass`.

## Scripts

| Script | What it does |
|--------|--------------|
| `bun run dev` | Vite dev server on :5173 |
| `bun run check` | `svelte-check` (Svelte 5 + TS) |
| `bun run check:watch` | Watch-mode type-check |
| `bun run build` | Production build (Node adapter, ssr) |
| `bun run preview` | Preview the build locally |

## Environment

`vite.config.ts` proxies `/api/*` to the backend; override with `BACKEND_URL`:

```env
# .env or shell
BACKEND_URL=http://localhost:3001
```

In production the SvelteKit server (running on Node/Bun) calls the backend directly via `BACKEND_URL`; the browser never sees the upstream URL.

## How auth works

```
                  ┌──────────────────────────────────┐
   browser  ───▶  │  SvelteKit server                │
   cookie         │   hooks.server.ts                │
                  │     fetchSession(cookie, origin) │ ───▶  backend /auth/get-session
                  │   event.locals.user = payload    │
                  │   route gate: redirect /login    │
                  └──────────────────────────────────┘
                           ▲                  │
                           │ Set-Cookie       │ event.locals.user
                           │ passthrough      ▼
                  /login   action ──── backend /auth/sign-in/email
                  /logout  +server ──── backend /auth/sign-out
```

- **`src/hooks.server.ts`** — on every request, calls the backend's `/auth/get-session` with the incoming cookie. Populates `event.locals.user`. Page routes (those with a `route.id`) that hit `/login` while signed in get redirected home; signed-out users hitting anything other than `/login` get bounced there. Static assets pass through.
- **`src/lib/server/auth.ts`** — small wrapper around backend auth endpoints. Parses `Set-Cookie` headers from the backend and forwards them through SvelteKit's `cookies.set` so the browser sees identical cookie attributes (HttpOnly, SameSite, Secure, Max-Age, …). Always sends an `Origin` header — better-auth's CSRF guard 403s mutating POSTs that lack one.
- **`src/lib/server/backend.ts`** — `BACKEND_URL` resolution + a typed `backendFetch` helper.

### Form actions

```
/login    POST  +page.server.ts → backendFetch /auth/sign-in/email
/logout   POST  +server.ts      → backendFetch /auth/sign-out
```

No client-side fetch for auth. After sign-in the action sets cookies and `throw redirect(303, '/')`. After sign-out the `+server.ts` clears cookies and redirects to `/login`.

## Layout

```
frontend/
├── src/
│   ├── app.d.ts                          App.Locals.user typing
│   ├── app.html                          mode-watcher injected synchronously to avoid FOUC
│   ├── hooks.server.ts                   session resolve + route gate
│   ├── lib/
│   │   ├── components/ui/                vendored shadcn-svelte primitives
│   │   └── server/
│   │       ├── auth.ts                   backend session + sign-in / sign-out helpers
│   │       └── backend.ts                BACKEND_URL + typed fetch
│   └── routes/
│       ├── +layout.server.ts             loads { user } for the whole tree
│       ├── +layout.svelte                shell, dark-mode toggle, header
│       ├── +page.svelte                  landing — applicant dashboard placeholder
│       ├── login/
│       │   ├── +page.svelte              email + password form
│       │   └── +page.server.ts           form action: sign-in + cookie passthrough
│       └── logout/
│           └── +server.ts                POST clears the session
├── components.json                       shadcn-svelte registry config
├── svelte.config.js                      adapter + path aliases
└── vite.config.ts                        /api → $BACKEND_URL proxy
```

## Conventions

- **Svelte 5 runes** — `$state`, `$derived`, `$effect`, `$props`. No `svelte/store` unless a third-party API demands it.
- **Server-first data loading.** Every page that needs backend data uses `+page.server.ts` `load`. Client-side `fetch` only for uploads, polling, or optimistic UI.
- **Shared types** — import `bnr-shared` for the state machine, transition events, role enum, and application status. Render only what the backend will accept.
- **Errors as UI** — the backend's `{ error, requestId, … }` shape (see `backend/src/errors.ts`) maps to:
  - inline `<Alert>` for form / load failures (e.g. login 401)
  - `sonner` toast for transient ones (e.g. document download fails mid-stream)
- **403 vs 404** — trust backend status codes. Don't hide a 403 as a 404 — the brief is explicit.
- **Path aliases** — anything two `..` deep gets aliased via `svelte.config.js` (`$lib`, `$lib/server`, `$lib/components/ui`).

## Dark mode

`mode-watcher` injects a class on `<html>` synchronously to avoid FOUC. Toggle on the landing page calls `toggleMode()`; preference is persisted in `localStorage` and falls back to `prefers-color-scheme`.

## Adding a shadcn-svelte component

Components are **vendored** under `src/lib/components/ui/` — they're our source code, edit freely. The CLI is only used to scaffold new ones:

```bash
cd frontend
bunx shadcn-svelte@latest add <name> -y
```

Currently vendored: `alert`, `badge`, `button`, `card`, `input`, `label`, `separator`, `skeleton`, `sonner`.

## Adding a protected page

```
src/routes/applications/
├── +page.server.ts        // load via backendFetch; redirect if !locals.user
├── +page.svelte           // render
└── [id]/
    ├── +page.server.ts    // backendFetch /applications/${params.id}
    └── +page.svelte
```

The route gate in `hooks.server.ts` already bounces unauth'd users to `/login`, so `+page.server.ts` `load` can assume `locals.user` exists. Use the `bnr-shared` `transition()` function to decide which action buttons to render — the backend will reject anything else.

## Common dev tasks

```bash
# Type-check while editing:
bun run check:watch

# Add a shadcn-svelte primitive (e.g. a dialog):
bunx shadcn-svelte@latest add dialog -y

# Tail the backend container while clicking around the UI:
docker compose -f ../docker/compose.yaml -f ../docker/compose.dev.yaml logs -f backend

# Reproduce a bug? Grab the x-request-id from the network panel and
# grep the backend log — every request emits one structured line.
```

## What's next

Feature work follows the [backend phase order](../docs/BNR%20Portal%20%E2%80%94%20implementation%20plan.html). Each new screen brings in only the shadcn-svelte primitives it actually needs (`dialog`, `sheet`, `table`, `form`, `select`, …).

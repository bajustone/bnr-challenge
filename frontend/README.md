# bnr-frontend

The user interface for the BNR Licensing Portal. Built with SvelteKit 2, Svelte 5 (using runes — `$state`, `$derived`, `$effect`, `$props`), Tailwind v4, and [shadcn-svelte](https://www.shadcn-svelte.com/) for components.

A few things to know up front about how this is wired:

The frontend is server-rendered and authenticates with cookies. Crucially, the browser never talks to the backend directly — every request goes through SvelteKit's server-side hooks, actions, and `load` functions. That means the session cookie stays HttpOnly, and better-auth's origin check on the backend takes care of CSRF for us.

## Getting started

From the repo root:

```bash
bun install
bun docker:dev                    # Postgres + backend in another terminal
bun --cwd frontend dev            # http://localhost:5173
```

Sign in with any of the [seeded users](../README.md#dev-credentials) — the password is `bnr-dev-pass` for all of them.

## Scripts

| Script | What it does |
|--------|--------------|
| `bun run dev` | Vite dev server on :5173 |
| `bun run check` | `svelte-check` (Svelte 5 + TypeScript) |
| `bun run check:watch` | Type-check in watch mode |
| `bun run build` | Production build (Node adapter, SSR) |
| `bun run preview` | Preview the production build locally |

## Environment

`vite.config.ts` proxies `/api/*` to the backend. To point at a different backend, override `BACKEND_URL`:

```env
# .env or your shell
BACKEND_URL=http://localhost:3001
```

In production, the SvelteKit server (running on Node or Bun) calls the backend directly using `BACKEND_URL`. The browser never sees the upstream URL — it only ever talks to SvelteKit.

## How auth works

The picture's simpler than it sounds. On every request, SvelteKit's `hooks.server.ts` calls the backend's `/auth/get-session` with the incoming cookie, decides who the user is, and stashes the result on `event.locals`. Then a route gate either redirects them to `/login` or lets them through.

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

The three files that matter:

- **`src/hooks.server.ts`** — runs on every request. Calls the backend's `/auth/get-session` with whatever cookie came in, populates `event.locals.user`, then handles the route gate. Page routes (anything with a `route.id`) that hit `/login` while signed in get redirected home, and signed-out users hitting anything other than `/login` get bounced there. Static assets pass through untouched.
- **`src/lib/server/auth.ts`** — a small wrapper around the backend's auth endpoints. It parses `Set-Cookie` headers coming back from the backend and forwards them through SvelteKit's `cookies.set`, so the browser ends up with identical cookie attributes (HttpOnly, SameSite, Secure, Max-Age, …). It always sends an `Origin` header too, because better-auth's CSRF guard will 403 a mutating POST that doesn't have one.
- **`src/lib/server/backend.ts`** — `BACKEND_URL` resolution and a typed `backendFetch` helper.

### Form actions

Auth flows go through form actions, not client-side `fetch`:

```
/login    POST  +page.server.ts → backendFetch /auth/sign-in/email
/logout   POST  +server.ts      → backendFetch /auth/sign-out
```

After sign-in, the action sets cookies and `throw redirect(303, '/')`. After sign-out, the `+server.ts` clears cookies and redirects back to `/login`.

## Folder layout

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

A few rules of thumb that keep the codebase consistent:

- **Use Svelte 5 runes.** `$state`, `$derived`, `$effect`, `$props`. Stick with these unless a third-party API forces you into `svelte/store`.
- **Load data on the server.** Anything that needs backend data should use `+page.server.ts` `load`. The browser only does client-side `fetch` for uploads, polling, or optimistic UI.
- **Share types via `bnr-shared`.** Import the state machine, transition events, role enum, and application status from there. Only render what the backend would actually accept.
- **Errors are part of the UI.** The backend's `{ error, requestId, … }` shape (from `backend/src/errors.ts`) maps to either an inline `<Alert>` for form or load failures (a 401 on login, say) or a `sonner` toast for transient ones (like a document download dropping mid-stream).
- **Don't paper over 403s.** The brief is explicit: trust the backend's status code. A 403 stays a 403; don't disguise it as a 404.
- **Path aliases.** Anything that would need two `..` to reach gets an alias in `svelte.config.js` — `$lib`, `$lib/server`, `$lib/components/ui`.

## Dark mode

`mode-watcher` injects a class on `<html>` synchronously, before paint, so there's no flash of unstyled content. The toggle on the landing page calls `toggleMode()`; the preference is persisted in `localStorage` and falls back to `prefers-color-scheme` if nothing's set.

## Adding a shadcn-svelte component

The shadcn-svelte components are **vendored** under `src/lib/components/ui/` — they're our source code, and you can edit them freely. The CLI exists only to scaffold new ones:

```bash
cd frontend
bunx shadcn-svelte@latest add <name> -y
```

Currently in the project: `alert`, `badge`, `button`, `card`, `input`, `label`, `separator`, `skeleton`, `sonner`.

## Adding a protected page

A typical protected route looks like this:

```
src/routes/applications/
├── +page.server.ts        // load via backendFetch; redirect if !locals.user
├── +page.svelte           // render
└── [id]/
    ├── +page.server.ts    // backendFetch /applications/${params.id}
    └── +page.svelte
```

You don't need to write the auth redirect by hand — the route gate in `hooks.server.ts` already does that. By the time your `+page.server.ts` `load` runs, you can assume `locals.user` exists. Use the `transition()` function from `bnr-shared` to decide which action buttons to render; the backend will reject anything the function wouldn't.

## Day-to-day tasks

```bash
# Type-check while you edit
bun run check:watch

# Add a shadcn-svelte primitive (a dialog, for example)
bunx shadcn-svelte@latest add dialog -y

# Tail the backend container while clicking around the UI
docker compose -f ../docker/compose.yaml -f ../docker/compose.dev.yaml logs -f backend

# Reproduce a bug? Grab x-request-id from the browser's network panel and
# grep the backend log for it — every request emits exactly one structured line.
```

## What's coming

Feature work follows the [backend phase order](../docs/BNR%20Portal%20%E2%80%94%20implementation%20plan.html). Each new screen pulls in only the shadcn-svelte primitives it actually needs — `dialog`, `sheet`, `table`, `form`, `select`, and so on.

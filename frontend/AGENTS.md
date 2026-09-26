# AGENTS.md

Stock Flow B2B order-management web app. This is `frontend/` of the `stock_flow` git repo
(git root is one level up; sibling `backend/` is the Django API). Next.js 16 App Router,
React 19, Tailwind v4, pnpm (`packageManager: pnpm@11.9.0`), Node `>=24 <25`.

## Commands
- `pnpm dev` — dev server (localhost:3000). `pnpm local` binds 0.0.0.0; `pnpm mobile` adds `--experimental-https` (phone testing).
- `pnpm lint` — ESLint (flat config, bare command). No typecheck script: verify types with `pnpm exec tsc --noEmit`.
- `pnpm test` — Vitest watch; `pnpm test:run` — single run. Tests live in `tests/` (jsdom, `tests/setup.ts`), currently pure-util only.

## Architecture
- Route groups in `app/`: `(auth)` login/forgot/reset, `(agent)/agent` sales agents, `(admin)/admin` warehouse, `(admin-no-layout)/admin/*` fullscreen pages without navbar.
- `proxy.ts` at root is Next 16's middleware (renamed from `middleware.ts`): clears expired JWT cookies and blocks non-ADMIN from `/admin`. Keep in sync with route guards in `context/AuthContext.tsx`.
- Auth is client cookies only (`token`, `auth_refresh`, `auth_user`, `role`, `business`, `is_superuser`). `AuthContext` redirects by role and logs out on 401. Do not assume SSR/session state.
- Backend calls go through `lib/api/*` (axios). Base URL = `NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"` (Django dev server). `.env*` is gitignored; media images require `NEXT_PUBLIC_MEDIA_DOMAIN` (see `next.config.ts`).

## Conventions
- Imports use `@/*` alias → frontend root.
- Tailwind v4 config is CSS-first in `app/globals.css`; shadcn/ui components (new-york) in `components/ui`.
- Don't change the strict version pins (Next 16.2.2, React 19.2.3, Node 24).
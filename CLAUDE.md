# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project-wide rules (from AGENTS.md)

- **Next.js 16**: APIs, conventions, and file structure may differ from training data. Check `node_modules/next/dist/docs/` before writing framework-level code. Heed deprecation notices.
- **Design system**: every UI change must obey `DESIGN.md` (Linear × Notion fusion). Tokens, radii (card `12px` / button `6px`), Inter Variable with `"cv01", "ss03"`, and the single indigo-violet accent (`#5e6ad2` / `#7170ff`) are non-negotiable. Run §10 iteration checklist before marking UI work done.

## Commands

```bash
npm run dev            # next dev — runs scripts/fetch-icons.ts first (predev)
npm run build          # next build (standalone output for Docker) — runs fetch-icons first
npm run lint           # eslint (flat config, eslint.config.mjs)
npm test               # vitest run (Node env, 80% coverage thresholds enforced)
npm run test:watch
npm run test:coverage
npx vitest run src/__tests__/billing.test.ts              # single file
npx vitest run -t "calculates pro-rated shares"           # single test by name
npm run fetch-icons    # regenerate public/icons/* + manifest.json
```

Docker: `docker compose up --build -d` → `https://localhost` (Caddy fronts Next with a self-signed cert).

## Environment

- `SESSION_SECRET` — required in production; HMAC key for signed session cookies (min 32 chars). Dev fallback exists.
- `DATABASE_URL` — SQLite path; defaults to `data/subshare.db`.
- `CRON_SECRET` — Bearer token for `POST /api/cron/billing`.

## Architecture

**Stack**: Next.js 16 App Router + React 19, TypeScript, Tailwind v4 + shadcn/ui, Drizzle ORM on SQLite (`better-sqlite3`), NextAuth is installed but auth is actually handled by a custom HMAC session (see below). Path alias `@/*` → `src/*`.

**Routing layout** (`src/app/`):
- `(app)/` — authenticated pages: `dashboard`, `groups`, `subscriptions`, `settings` (share one `layout.tsx`).
- `(auth)/` — login / register.
- `api/` — route handlers grouped by resource: `auth`, `dashboard`, `groups/[id]` (+ `join`, `leave`), `subscriptions/[id]`, `billing/[id]/paid`, `exchange-rate`, `cron/billing`, `icons`.
- `join/` — invite-link landing.

**Data layer** (`src/db/`):
- `schema.ts` — Drizzle schemas for `users`, `groups`, `groupMembers`, `subscriptions`, `billingRecords`, `categories`. All money is stored as integer cents (`price`, `amount`, `localAmount`, `monthlyBudget`). `exchangeRate` is stored as `rate × 1_000_000`.
- `index.ts` — `getDb()` is a lazy singleton that opens SQLite, sets `WAL` + `foreign_keys = ON`, and auto-runs `migrate()` on first connection. `createTestDb()` returns an in-memory DB for tests.
- `migrate.ts` — idempotent `CREATE TABLE IF NOT EXISTS` + default category seed. Schema changes require mirroring Drizzle `schema.ts` and the raw DDL here.

**Business logic** (`src/lib/`):
- `billing.ts` — pure functions: `calculateShares` uses floor division so the payer absorbs the rounding remainder; pro-rated joining computes days remaining in the current cycle. Exchange rate is injected via `ExchangeRateFetcher` so tests can stub it.
- `db-operations.ts` — CRUD helpers, all taking a `db` argument for testability.
- `api-handlers.ts` — request-shaped business logic called from route handlers; keeps `app/api/**/route.ts` thin.
- `session.ts` — HMAC-SHA256-signed cookie (`subshare_session`), base64url payload + signature. Secret is lazy-resolved at request time; throws in production if `SESSION_SECRET` missing.
- `validators.ts` — Zod schemas for API input.
- `rate-limit.ts` — login throttling.
- `icon-sources.ts` / `icons.ts` / `popular-services.ts` — drive the build-time icon pipeline (Simple Icons → DDG favicon → Google favicon → generated letter SVG), output at `public/icons/` + `manifest.json`. `predev`/`prebuild` always run this.

**Billing model**: the group creator is the payer. For each cycle, billing records are created per non-payer member in their preferred currency using the stored FX rate; members settle out-of-band and click "Paid" to flip `is_paid`. The `/api/cron/billing` endpoint advances cycles and is protected by `CRON_SECRET`.

**Tests** (`src/__tests__/`): 65 tests covering `billing`, `db-operations`, and API handlers. Use `createTestDb()` for isolation. Coverage thresholds of 80% (lines/functions/branches/statements) are enforced by `vitest.config.ts`.

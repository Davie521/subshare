# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This is NOT the Next.js you know

Next.js 16 has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any framework-level code. Heed deprecation notices.

## Design system

All UI work **must** follow `docs/DESIGN.md`. It is a Linear × Notion fusion system with:

- Dual-mode: light = warm-paper (Notion), dark = near-black precision (Linear)
- Single brand accent: indigo-violet `#5e6ad2` / `#7170ff`
- Inter Variable with `font-feature-settings: "cv01", "ss03"` (non-negotiable, set at root)
- Card radius `12px`, button radius `6px` (this 2-step ratio is the signature)
- Warm-neutral grays in light mode, white-opacity surfaces + luminance stacking in dark mode

Before writing any component, colour, typography, spacing, or shadow — consult `docs/DESIGN.md` and match its tokens/rules. Run through the iteration checklist in §10 before declaring a UI task done.

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

Docker: `docker compose up --build -d` → `http://localhost:3000`.

## Deployment constraints

- **Single-instance only.** `src/lib/rate-limit.ts` stores attempt counters in a per-process `Map`. Do not run multiple Node processes (no pm2 cluster, no horizontal scaling, no Vercel multi-region). Before scaling out, replace with Redis/Upstash-backed rate limiting.
- **Long-running process.** `handleCreateSubscription` uses fire-and-forget background billing generation after returning. This only works in persistent runtimes (Docker, bare Node). Serverless platforms kill the function after the response — migrate to a queue before switching.

## Environment

- `SESSION_SECRET` — required in production; HMAC key for signed session cookies (min 32 chars). Dev fallback exists.
- `DATABASE_URL` — Postgres connection string (required).
- `CRON_SECRET` — Bearer token for `POST /api/cron/billing`.

## Architecture — **subscription-centric**

**Stack**: Next.js 16 App Router + React 19, TypeScript, Tailwind v4 + shadcn/ui, Drizzle ORM on SQLite (`better-sqlite3`). Auth is a custom HMAC session (NextAuth is *not* wired). Path alias `@/*` → `src/*`.

### Primary concept
Each **subscription** is the primitive. It has its own `payer_id` (the person whose card pays) and its own `subscription_members` (who splits the cost). Friendships auto-form when one user adds another to a sub. There is no "group" in the current UX — the old `groups` / `group_members` tables still exist in the schema for backward compat with existing DBs but are not used by new UI or primary code paths.

### Routing layout (`src/app/`)
- `(app)/` — authenticated pages, share one `layout.tsx`:
  - `dashboard` — at-a-glance home (stats + activity preview + subs preview)
  - `subscriptions` — list + create + detail
  - `activity` — unified "everything happening" feed: Action needed / Incoming / Updates
  - `settlement` — Mark-settled workspace with Unpaid / Paid toggle
  - `friends` — people you've co-subscribed with
  - `settings` — profile, display name, email visibility, sign out
- `(auth)/` — login / register
- `api/` — route handlers grouped by resource: `auth`, `dashboard`, `subscriptions/[id]` (+ `members`, `payer`), `billing/[id]/paid`, `settlement`, `friends`, `notifications`, `exchange-rate`, `cron/billing`, `icons`

### Data layer (`src/db/`)
- `schema.ts` — Drizzle schemas for `users`, `subscriptions`, `subscription_members`, `friendships`, `notifications`, `billingRecords`, `categories`. Legacy `groups` / `groupMembers` tables kept for backfill compat. All money is stored as integer cents (`price`, `amount`, `localAmount`, `monthlyBudget`). `exchangeRate` is stored as `rate × 1_000_000`.
- `index.ts` — `getDb()` is a lazy singleton that opens SQLite, sets `WAL` + `foreign_keys = ON`, and auto-runs `migrate()` on first connection. `createTestDb()` returns an in-memory DB for tests.
- `migrate.ts` — idempotent `CREATE TABLE IF NOT EXISTS` + `backfillFromGroups()` for legacy data.

### Business logic (`src/lib/`)
- `billing.ts` — pure functions. `calculateShares` uses floor division (payer absorbs remainder). `calculateProRate` computes days remaining in current cycle for R2 mid-month joins. Exchange rate is injected via `ExchangeRateFetcher` so tests can stub it.
- `db-operations.ts` — CRUD + membership rules. `addMemberToSubscription`, `leaveSubscription` (R7 payer guard), `transferPayer`, `changeSubscriptionPrice` (R5 rewrite), `generateMonthlyBills` (R1 cron), `generateAndSaveBillingRecords` (legacy per-sub), `backfillFromGroups` (migration).
- `settlement.ts` — pair-level netting. `getSettlementSummary` (unpaid) and `getSettledHistory` (paid) share `bucketByPairCurrency`. `markPairSettled` atomically flips every unpaid bill in a (userA, userB, currency) bucket.
- `notifications.ts` — in-app feed CRUD, unread count, 30-day cleanup. Types: `added_to_sub`, `removed_from_sub`, `price_changed`, `payer_changed`.
- `api-handlers.ts` — request-shaped business logic called from route handlers; keeps `app/api/**/route.ts` thin.
- `session.ts` — HMAC-SHA256-signed cookie (`subshare_session`). Secret is lazy-resolved at request time; throws in production if `SESSION_SECRET` missing.
- `validators.ts` — Zod schemas for API input.
- `rate-limit.ts` — login throttling.
- `icon-sources.ts` / `icons.ts` / `popular-services.ts` — build-time icon pipeline (Simple Icons → DDG favicon → Google favicon → generated letter SVG). `predev` / `prebuild` always run this.

## Billing math

PRE-PAID calendar-month model. Key rules:

- **R1** — on the 1st of each month, cron generates one `share(n) = floor(price / n)` bill per active non-payer member; `billing_date = M_start`; payer absorbs rounding remainder (by not being billed).
- **R2** — mid-month join → immediate pro-rata bill for remaining days, `billing_date = join_date`. Actionable now or bundled with next 1st.
- **R3** — leaving doesn't refund or generate new bills; member excluded from next month's R1.
- **R4** — adding/leaving recomputes `share(n)` for future cycles only; prior bills not retroactively adjusted.
- **R5** — **price change rewrites current-month `is_paid=0` bills** with the new price (pro-rata ratio preserved for R2 joiners). Already-paid bills untouched. FX stays locked (no re-fetch). `price_changed` notification emitted.
- **R7** — payer can't leave a sub; must transfer payer first.
- **R8** — payer has no `billing_records` (they paid the service directly).
- **R9** — the 1st is both the billing day and the settlement-reminder day. "Mark settled" is available any day.
- **R10** — netting is per `(userA, userB, currency)` bucket. No cross-currency netting; different currencies render as separate settlement rows.

## Tests (`src/__tests__/`)
221 tests covering billing math, db operations, settlement, notifications, and API handlers. Use `setupTestDb()` from `helpers.ts` for isolation. Coverage thresholds of 80% (lines/functions/branches/statements) enforced by `vitest.config.ts`.

Convention: each feature task is a RED/GREEN pair — `test(Tn): RED for X` commits failing tests first, `fix(Tn): X` implements to green. See commit history for the pattern.


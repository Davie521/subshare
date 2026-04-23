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

## Local development (hybrid mode)

Recommended: run Postgres in Docker, Next locally. Fast HMR, easy debugging.

```bash
cp .env.example .env.local          # first time only; dev secrets already good-to-go
docker compose up -d postgres       # start Postgres (port 5432)
npm install
npm run dev                         # Next at http://localhost:3000
```

Stop Postgres when done: `docker compose down`.

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
npm run seed           # populate dev DB with dummy users/subs/bills
npm run seed:reset     # wipe + reseed
```

Full Docker (pre-deploy smoke test): `docker compose up --build -d` → `http://localhost:3000`.

## Deployment

Target: **Railway** (Dockerfile-based, Postgres plugin). Full setup + env vars + cron scheduling in `docs/DEPLOYMENT.md`.

**CI/CD**: GitHub Actions — PRs get lint/typecheck/test/build gate (`ci.yml`); push to `main` runs the same gate then `railway up` via CLI (`deploy.yml`). Monthly billing cron also runs via GH Actions. See `docs/DEPLOYMENT.md` § CI/CD for secrets and details.

Two hard constraints (detailed in that doc):
- **Single-instance only** — rate limiter uses in-process `Map`.
- **Long-running process required** — background billing generation after HTTP return doesn't survive serverless.

## Environment

See `.env.example` for the full template.

- `DATABASE_URL` — Postgres connection string (required).
- `SESSION_SECRET` — HMAC key for session cookies, 32+ chars. Required in production (dev has insecure fallback).
- `CRON_SECRET` — Bearer token for `POST /api/cron/billing`.
- `APP_TIMEZONE` — IANA timezone for calendar-date semantics (billing_date, addedAt/leftAt, cron's "today"). Defaults to `Asia/Shanghai`. Set to match your user base — UTC on a non-UTC user base will shift date boundaries and can make the 1st-of-month R1 cron miss its window.

## Architecture — **subscription-centric**

**Stack**: Next.js 16 App Router + React 19, TypeScript, Tailwind v4 + shadcn/ui, Drizzle ORM on Postgres (`postgres-js` in prod/dev, `@electric-sql/pglite` in-memory for tests). Auth is a custom HMAC session (NextAuth is *not* wired). Path alias `@/*` → `src/*`.

### Primary concept
Each **subscription** is the primitive. It has its own `payer_id` (the person whose card pays) and its own `subscription_members` (who splits the cost). Friendships auto-form when one user adds another to a sub. There is no "group" in the current UX — the old `groups` / `group_members` tables still exist in the schema for backward compat with existing DBs but are not used by new UI or primary code paths.

### Routing layout (`src/app/`)
- `(app)/` — authenticated pages, share one `layout.tsx`:
  - `dashboard` — at-a-glance home (stats + activity preview + subs preview)
  - `subscriptions` — list + create + detail
  - `activity` — unified "everything happening" feed: Action needed / Incoming / Updates
  - `settlement` — Mark-settled workspace with Unpaid / Paid toggle
  - `friends` — people you've co-subscribed with
  - `settings` — profile, display name, email visibility, sign out; includes `settings/circles` (see below)

**Circles** (`src/app/api/circles`, `src/app/(app)/settings/circles`) are user-defined member templates — a named group like "Family" with a preset `memberIds` + optional `defaultPayerId`. The "new subscription" form exposes them as a one-tap member picker. They are an orthogonal UI helper — the billing/friendship model is still subscription-centric (circles don't create any shared state).

The legacy `groups` / `group_members` tables in `schema.ts` are unused except as the source for the one-shot `backfillFromGroups()` migration (kept for anyone upgrading from the pre-refactor DB).
- `(auth)/` — login / register
- `api/` — route handlers grouped by resource: `auth`, `dashboard`, `subscriptions/[id]` (+ `members`), `billing/[id]/paid`, `settlement`, `friends`, `notifications`, `exchange-rate`, `cron/billing`

### Data layer (`src/db/`)
- `schema.ts` — Drizzle `pg-core` schemas for `users`, `subscriptions`, `subscription_members`, `friendships`, `notifications`, `billingRecords`, `categories`. Legacy `groups` / `groupMembers` tables kept for backfill compat. All money is stored as integer cents (`price`, `amount`, `localAmount`, `monthlyBudget`). `exchangeRate` is stored as `rate × 1_000_000`.
- `index.ts` — `getDb()` is a lazy singleton around `postgres-js` (pool size 10) that auto-runs `migrate()` once on first connection. Queries must be **awaited** — postgres-js is async end-to-end (unlike the SQLite predecessor this code was ported from).
- `migrate.ts` — idempotent `CREATE TABLE IF NOT EXISTS` + `backfillFromGroups()` for legacy data. Statements are executed one-at-a-time to work around Drizzle's extended-query protocol not supporting multi-statement.
- Tests use `src/__tests__/helpers.ts` → `setupTestDb()`, which spins up a fresh `PGlite` in-memory Postgres per test and runs the same `migrate()`. A `SqliteShim` translates `?` placeholders to `$1…$n` for legacy code paths that still use prepared-statement syntax.

### Business logic (`src/lib/`)
- `billing.ts` — pure functions. `calculateShares` uses floor division (payer absorbs remainder). `calculateProRate` computes days remaining in current cycle for R2 mid-month joins. Exchange rate is injected via `ExchangeRateFetcher` so tests can stub it.
- `db-operations.ts` — CRUD + membership rules. `addMemberToSubscription` (handles rejoin via row reuse), `leaveSubscription` (R3 prorate + R7 payer guard + R11 redistribute), `changeSubscriptionPrice` (R5 rewrite), `generateMonthlyBills` (R1 cron), `generateAndSaveBillingRecords` (legacy per-sub), `backfillFromGroups` (migration). Note: the payer role is fixed at subscription creation — there is no transfer-payer path.
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
- **R3** — **mid-cycle leave prorates the leaver's unpaid current-month bill by days used** (leave day not counted). Formula: `new_amount = floor(bill.amount × usage_days / coverage_days)` where `coverage_days = daysInMonth − billing_date.day + 1`. `usage_days = 0` deletes the bill; leaving on the last day of the month counts as full coverage. Already-paid bills are immutable. No min-commitment period — members can leave any time.
- **R4** — adding recomputes `share(n)` for future cycles only. Previously-billed amounts are not retroactively adjusted, except by R3 (leave) and R5 (price change).
- **R5** — **price change rewrites current-month `is_paid=0` bills** with the new price (pro-rata ratio preserved for R2 joiners). Already-paid bills untouched. FX stays locked (no re-fetch). `price_changed` notification emitted.
- **R6** — **deleting a subscription wipes everything**. Only the payer can delete. All `billing_records` (paid AND unpaid) are cascade-deleted along with members. Deletion forgives all debts on that sub.
- **R7** — payer cannot leave a sub. The payer must delete the sub instead.
- **R8** — payer has no `billing_records` (they paid the service directly).
- **R9** — the 1st is both the billing day and the settlement-reminder day. "Mark settled" is available any day.
- **R10** — netting is per `(userA, userB, currency)` bucket. No cross-currency netting; different currencies render as separate settlement rows.
- **R11** — **`subscriptions.refund_policy`** (creator picks at create-time) controls how the diff from R3 is handled: `payer_absorbs` (default) — payer eats the loss; other members unchanged. `redistribute` — diff is split across remaining unpaid non-payer bills in the same month (falls back silently to `payer_absorbs` if no such member exists); affected members receive a `bill_adjusted` notification.

## Tests (`src/__tests__/`)
~233 tests across 32 files covering billing math, db operations, settlement, notifications, and API handlers. Use `setupTestDb()` from `helpers.ts` for isolation (fresh PGlite per test). Coverage thresholds of 80% (lines/functions/branches/statements) enforced by `vitest.config.ts`.

Convention: each feature task is a RED/GREEN pair — `test(Tn): RED for X` commits failing tests first, `fix(Tn): X` implements to green. See commit history for the pattern.


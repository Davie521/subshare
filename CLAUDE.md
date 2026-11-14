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
cp .env.example .env                # first time only; fill SESSION_SECRET + CRON_SECRET (compose won't start without them)
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
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_REDIRECT_URI` — Google OAuth, the only sign-in outside `npm run dev` (which also has `/api/dev/login?uid=N`).
- `PGSSLMODE` — `disable` turns off Postgres TLS (local compose Postgres); unset means `ssl: 'prefer'`.
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
- `fair-allocation.ts` + `engine/` — the billing engine (see Billing math): `fairAllocation` (pure per-day split), `engine/recompute.ts` (`recomputeMonth`, reconciles one sub-month), `engine/cron.ts` (`runR1Cron`, monthly run), `engine/edit-added-at.ts` (owner edits a member's start date), `engine/lifecycle.ts` (which members the detail page shows).
- `membership.ts` / `billing-ops.ts` / `billing.ts` — the older per-event bill writers (join bill, leave prorate + refund policy, price-change rewrite, creation backfill) and their pure math. They still run first on each event; the engine's recompute then corrects the month. Note: the payer role is fixed at subscription creation — there is no transfer-payer path.
- `db-operations.ts` — CRUD helpers: `createSubscription` (owner becomes the first member), `lockSubscription`, member/bill queries, `markBillPaid`. `cron-billing.ts` (`generateMonthlyBills`) is the pre-engine monthly job, no longer called by the app.
- `settlement.ts` — pair-level netting. `getSettlementSummary` (unpaid) and `getSettledHistory` (paid) share `bucketByPairCurrency`. `markPairSettled` atomically flips every unpaid bill in a (userA, userB, currency) bucket.
- `notifications.ts` — in-app feed CRUD, unread count, 30-day cleanup. Types: `added_to_sub`, `removed_from_sub`, `price_changed`, `payer_changed`.
- `api-handlers.ts` — request-shaped business logic called from route handlers; keeps `app/api/**/route.ts` thin.
- `session.ts` — HMAC-SHA256-signed cookie (`subshare_session`). Secret is lazy-resolved at request time; throws in production if `SESSION_SECRET` missing.
- `validators.ts` — Zod schemas for API input.
- `rate-limit.ts` — login throttling.
- `icon-sources.ts` / `icons.ts` / `popular-services.ts` — build-time icon pipeline (Simple Icons → DDG favicon → Google favicon → generated letter SVG). `predev` / `prebuild` always run this.

## Billing math

Calendar months, pre-paid, integer cents in the subscription's currency. The **fair engine** (`src/lib/fair-allocation.ts`, `src/lib/engine/*`) decides what everyone owes. The older per-event writers (`membership.ts`, `billing-ops.ts`) still run first on join/leave/price change, then the engine reconciles the month, so the engine's numbers are what stick.

- **Per-day fair share** (`fairAllocation`). Each day of the month costs `price(d) / daysInMonth` (with a single price for the whole month: `price / activeDays`) and is split equally among the members active that day; a member owes the sum over their days. Membership intervals are closed `[addedAt, leftAt]`, and a rejoiner's earlier stints (`previous_intervals`) count too. Rounding residue is rotated by a (sub, year, month) seed so the shares add up to the month's total. **The payer is a member and has a share like everyone else.**
- **Price timeline.** `subscriptions.price_history` holds `{ price, effectiveFrom }` entries. A change applies from its `effectiveFrom` (must be within ±31 days of today), so a mid-month change blends per day. `subscriptions.price` is the price in effect today.
- **Reconcile** (`recomputeMonth`, one transaction per sub-month, idempotent on `event_id`). For each user it takes `fair − sum(existing rows this month)` and applies the difference to, in order: their unpaid bill (if it stays ≥ 0), else their open adjustment, else a new bill when they have none (the payer's is inserted already paid), else a new signed **adjustment** row (`adjustment_for_bill_id` → the paid bill). Paid rows are never edited. Each changed user gets a `bill_adjusted` notification.
- **When it runs.** `POST /api/cron/billing` → `runR1Cron`: for each active sub, advance `next_payment`, recompute the current month, then fold earlier months' unpaid adjustments into the user's new bill (or a standalone bill for a former member) and mark them paid. Add member, leave/remove and price change recompute the current month afterwards (`reconcileCurrentMonth` in `api-handlers.ts`). An owner editing a member's `addedAt` (up to 6 months back) recomputes every month from the earlier date to today in one transaction.
- **FX.** Each bill also stores `local_amount` in the member's preferred currency, with the rate locked at creation (`exchange_rate` = rate × 1_000_000); later edits reuse the locked rate. A missing rate is never billed as 1:1: `recomputeMonth` throws `MissingFxRateError`, the cron skips and logs that sub, and user actions log it and leave the month unreconciled.
- **`refund_policy`** (`payer_absorbs` / `redistribute`) is still stored and applied by the old leave code, but the reconcile that follows replaces its result with the per-day split, so it does not change final amounts: a leaver's remaining days are shared by whoever is still in the plan, payer included.
- **Payer.** Cannot leave (`leaveSubscription` throws); no transfer path. Only the payer can delete a subscription; delete cascades its members and every bill, paid or unpaid, so debts on it are forgiven.
- **Settlement** (`settlement.ts`). One net number per counterparty: all unpaid bills between the two users, converted at live rates into the per-friend agreed currency or the viewer's preferred currency (`getNormalizedSettlement`; a missing rate marks the row FX-incomplete). "Mark settled" flips those bills to paid (`markPairSettled`); `settlement_due` notifications are re-synced when notifications are listed, on settle, and when a friend's agreed currency changes.

## Tests (`src/__tests__/`)
~625 tests across 58 files covering billing math, db operations, settlement, notifications, and API handlers. Use `setupTestDb()` from `helpers.ts` for isolation (fresh PGlite per test). Coverage thresholds of 80% (lines/functions/branches/statements) enforced by `vitest.config.ts`.

Convention: each feature task is a RED/GREEN pair — `test(Tn): RED for X` commits failing tests first, `fix(Tn): X` implements to green. See commit history for the pattern.


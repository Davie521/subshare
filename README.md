# SubShare

> Split subscription costs with friends. Pre-paid calendar-month model, mid-cycle prorate, per-pair netting, multi-currency. Self-hosted, minimal, mobile-first.

**Live demo**: https://subshare-production.up.railway.app
**语言 / Language**: [English](README.md) · [中文](README.zh.md)

---

## Why SubShare

SplitWise models **one-off** expenses — dinner, groceries, trips. But the people I actually split money with every month are split on **subscriptions** — Netflix, iCloud, Disney+, Spotify family plans, Steam games sharing. Those need a different model:

- **Recurring, not one-off**: you want to *not* re-enter the bill every month.
- **Pre-paid, not post-paid**: the payer's card is charged upfront, others owe *them* — not the service.
- **Calendar-month cycle**: the 1st is a natural settlement moment.
- **Mid-cycle mutations are the norm**: friends join in May, leave in July, the price goes up in September. The accounting has to handle all of this without surprises.

SubShare is a bookkeeping tool for recurring sharing. Money never flows through it — you transfer via WeChat / Venmo / bank, then mark the bucket settled.

---

## Features

### Subscriptions
- **Personal + Shared** in one catalog; tag/filter by status.
- **Any member can be the payer** — the person whose card is charged.
- **Friendships auto-form** when you add someone to a sub. No separate friend-request flow.
- **Icon pipeline** pulls brand logos from Simple Icons, falls back to DDG/Google favicons, then to a generated letter SVG. Works offline after first build.

### Billing (pre-paid, calendar-month)
- **R1 monthly cron** on the 1st generates one `share = floor(price / n)` bill per non-payer member. Payer absorbs the rounding remainder.
- **R2 mid-month join** — immediate pro-rata bill covering remaining days.
- **R3 mid-cycle leave** — the leaver's unpaid bill is rewritten to `floor(share × usage_days / coverage_days)`. Paid bills stay locked. No refunds — already-transferred money isn't pulled back.
- **R5 price change** — current-month unpaid bills are rewritten with the new price; FX locked; already-paid bills untouched.
- **R11 refund_policy** — when a leaver's bill shrinks, the difference is either absorbed by the payer (default) or redistributed across remaining unpaid non-payer bills (creator picks at sub creation; editable later).

### Settlement
- **Pair-level netting per currency** on the 1st of each month: one net transfer per counterparty per currency.
- **Mark settled** flips every unpaid bill in a `(userA, userB, currency)` bucket to paid. Atomic.
- **Per-friend preferred currency** — override the sub's currency when settling with that specific friend.

### Multi-currency
- CNY, USD, HKD, CAD, EUR, GBP, JPY with live FX (frankfurter.app).
- FX is locked at bill creation — re-generating a rate wouldn't match what was already presented.
- **No cross-currency netting** in MVP — different currencies render as separate settlement rows. Simpler to reason about.

### UI
- **Linear × Notion fusion** design system (see `docs/DESIGN.md`): warm-paper light mode (Notion), near-black precision dark mode (Linear), single indigo-violet brand accent.
- **Mobile-first** bottom nav, desktop sidebar.
- **Inter Variable** with OpenType features `cv01` + `ss03` enabled globally.

---

## How the billing model actually works

If you read only one section, read this.

```
Month M, 31 days. Shared Netflix (¥30).
Members: Alice (payer), Bob, Carol.

Day 1 — R1 cron:
  Bob bill: floor(30 / 3) = ¥10  (is_paid=false, billing_date=M-01)
  Carol bill: ¥10
  Alice absorbs: 30 − 10 − 10 = ¥10

Day 10 — Dave joins:
  New member count = 4; Dave gets an R2 pro-rata bill:
    share = floor(30 / 4) = ¥7
    coverage_days = 31 − 10 + 1 = 22
    Dave bill: floor(7 × 22 / 31) = ¥4  (billing_date=M-10)
  Bob and Carol's current-month bills stay at ¥10 (R4: only future cycles
    recompute share; prior bills untouched).

Day 20 — Carol leaves:
  Carol's ¥10 bill (unpaid) is rewritten:
    coverage_days = 31 − 1 + 1 = 31
    usage_days = 20 − 1 = 19
    new amount = floor(10 × 19 / 31) = ¥6
  With refund_policy = 'payer_absorbs' (default): Alice just collects ¥6
    instead of ¥10 from Carol. Bob and Dave unchanged.
  With refund_policy = 'redistribute': the ¥4 diff is split across Bob and
    Dave's unpaid bills. (Both get a bill_adjusted notification.)

Day 1 of M+1 — settlement reminder:
  Alice sees: "Bob owes ¥10, Carol owes ¥6, Dave owes ¥4".
  Bob transfers via WeChat, Alice clicks "Mark settled" on Bob's bucket →
    his bill flips to is_paid=true. Repeat for Carol and Dave.
```

Full billing rules (R1–R11) in `CLAUDE.md` under **Billing math**.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 App Router + React 19 |
| Language | TypeScript (strict) |
| UI | shadcn/ui + Tailwind v4 + Base UI primitives |
| Database | PostgreSQL (prod/dev), PGlite (tests) |
| ORM | Drizzle (`pg-core`) |
| Auth | HMAC-SHA256 session cookies (no NextAuth) |
| Validation | Zod |
| Tests | Vitest + @testing-library/react |
| Deployment | Docker → Railway |

---

## Quick Start

### Recommended: hybrid dev (Postgres in Docker, Next local)

```bash
git clone https://github.com/Davie521/subshare.git
cd subshare
cp .env.example .env.local          # dev secrets are good to go
docker compose up -d postgres       # Postgres on :5432
npm install
npm run dev                         # Next on :3000
```

### Full Docker (pre-deploy smoke test)

```bash
docker compose up --build -d
```

Open **http://localhost:3000** and register.

### Seed dummy data

```bash
npm run seed                # users, subs, bills
npm run seed:reset          # wipe first, then seed
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | **Yes** | Postgres connection string, e.g. `postgres://user:pass@host:5432/subshare` |
| `SESSION_SECRET` | **Yes in prod** | HMAC key for session cookies, min 32 chars. Dev has an insecure fallback. |
| `CRON_SECRET` | Optional | Bearer token guarding `POST /api/cron/billing` |

Full template in `.env.example`; deployment specifics in `docs/DEPLOYMENT.md`.

---

## Commands

```bash
npm run dev              # dev server (runs fetch-icons predev)
npm run build            # standalone production build
npm run lint             # eslint (flat config)
npm test                 # vitest run (233 tests, ~80s)
npm run test:watch       # watch mode
npm run test:coverage    # with coverage report
npx vitest run src/__tests__/billing.test.ts              # single file
npx vitest run -t "calculates pro-rated shares"           # single test
npm run fetch-icons      # regenerate public/icons/*
npm run seed             # seed dummy data
```

---

## Project Structure

```
src/
├── app/
│   ├── (app)/                   # Authenticated pages — share layout.tsx
│   │   ├── dashboard/           # Monthly spending + Updates + Subs preview
│   │   ├── subscriptions/       # List / create / detail
│   │   ├── settlement/          # Mark-settled workspace (unpaid / paid)
│   │   ├── friends/             # Co-subscribers + per-friend currency
│   │   └── settings/            # Profile, preferences, sign out
│   ├── (auth)/                  # Login, register
│   └── api/                     # Route handlers — thin, delegate to lib/api-handlers
├── components/                  # Shared UI (shadcn-based + brand components)
├── db/
│   ├── schema.ts                # Drizzle pg-core tables
│   ├── index.ts                 # Lazy singleton + auto-migrate on first connect
│   └── migrate.ts               # Idempotent CREATE TABLE IF NOT EXISTS + backfills
├── lib/
│   ├── billing.ts               # Pure math: shares, pro-rata (join + leave), spending
│   ├── db-operations.ts         # CRUD + membership rules + R1/R2/R3/R5 cron paths
│   ├── settlement.ts            # Pair-level netting + mark-settled (atomic)
│   ├── notifications.ts         # In-app feed CRUD, unread count, 30-day cleanup
│   ├── api-handlers.ts          # Request-shaped business logic
│   ├── session.ts               # HMAC-signed cookies
│   ├── validators.ts            # Zod schemas for every API input
│   └── rate-limit.ts            # Login throttling (in-process Map — single-instance)
├── __tests__/                   # 233 tests: billing math, db ops, settlement, API
└── docs/
    ├── DESIGN.md                # Linear × Notion design system (non-negotiable)
    └── DEPLOYMENT.md            # Railway deployment guide
```

---

## API

All `/api/*` routes require a valid `subshare_session` cookie unless otherwise noted.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in (rate-limited) |
| POST | `/api/auth/logout` | Sign out |
| GET / PUT | `/api/auth/me` | Current user / update profile |
| GET | `/api/dashboard` | Monthly spending + pending bills + subs |
| GET / POST | `/api/subscriptions` | List / create (accepts `members[]`, `payerId`, `refundPolicy`) |
| GET / PUT / DELETE | `/api/subscriptions/[id]` | CRUD (PUT routes price changes via R5, delete enforces R6/R7) |
| POST / DELETE | `/api/subscriptions/[id]/members[/[userId]]` | Add member / leave / kick |
| PUT | `/api/billing/[id]/paid` | Mark one bill paid |
| GET / POST | `/api/settlement` | Pair-netted outstanding / mark a bucket settled |
| GET | `/api/friends` | Friend list + per-friend currency override |
| PUT | `/api/friends/[id]/currency` | Set preferred settlement currency with one friend |
| GET | `/api/notifications` | In-app feed + unread count |
| PUT | `/api/notifications/[id]/read` · `/api/notifications/read-all` | Mark read |
| GET / POST / PUT / DELETE | `/api/circles` | Group presets (UI label: "Group") |
| GET | `/api/exchange-rate` | Frankfurter FX rate proxy |
| GET | `/api/icons` · `/api/icons/popular` | Icon manifest lookup |
| POST | `/api/cron/billing` | Run R1 monthly pass (requires `Authorization: Bearer $CRON_SECRET`) |

---

## Deployment

Target platform: **Railway**. See `docs/DEPLOYMENT.md` for the full walkthrough (Postgres plugin wiring, env vars, cron scheduler).

Two hard constraints:

1. **Single-instance only** — the login rate limiter uses an in-process `Map`. Scaling horizontally would reset counters per pod.
2. **Long-running process required** — background billing generation happens *after* the HTTP response returns. Serverless functions kill that before it finishes.

Live deployment: https://subshare-production.up.railway.app

---

## Tests

- **233 tests** across 32 files (billing math, db ops, settlement, notifications, API handlers).
- Each test gets a fresh **PGlite** in-memory Postgres via `setupTestDb()` — no shared state, no fixtures to clean up.
- Coverage thresholds: **80% lines / functions / branches / statements** enforced in `vitest.config.ts`.

Convention: feature tasks ship as RED/GREEN commit pairs — `test(Tn): RED for X` writes the failing test first, `fix(Tn): X` implements it.

---

## License

MIT

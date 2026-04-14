# SubShare

Split subscription costs with friends. Self-hosted, minimal, mobile-friendly.

## Features

- **Personal subscriptions** — track your own Netflix, Spotify, iCloud, etc.
- **Shared subscriptions** — add any friend to any sub; split costs equally; any member can be the payer.
- **Pairwise netting** — one net transfer per person per currency on the 1st of each month, instead of paying bill-by-bill.
- **Activity** — a single page surfacing everything: money you owe, money coming in, and events (member added, price change, payer transfer).
- **Dashboard** — at-a-glance monthly spending, subscriptions overview, and a preview of what needs attention.
- **Pro-rated joining** — members who join mid-month pay for remaining days only.
- **Price-change rewrite** — when the owner changes a sub's price, current-month unpaid bills are rewritten to the new price; already-paid bills stay locked.
- **Multi-currency** — CNY, USD, HKD, CAD, EUR, GBP, JPY with real-time FX. No cross-currency netting in MVP (per-currency buckets).
- **Mobile + Desktop** — bottom nav on mobile, sidebar on desktop.

## Tech Stack

- **Framework**: Next.js 16 + TypeScript
- **UI**: shadcn/ui + Tailwind CSS
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: HMAC-signed session cookies
- **Deployment**: Docker (Railway-ready)

## Quick Start (Docker)

```bash
git clone https://github.com/Davie521/subshare.git
cd subshare
docker compose up --build -d
```

Open **http://localhost:3000** and register an account.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_SECRET` | Yes (production) | dev fallback | HMAC signing key for session cookies (min 32 chars) |
| `DATABASE_URL` | Yes | — | Postgres connection string (e.g. `postgres://user:pass@host:5432/subshare`) |
| `CRON_SECRET` | No | — | Bearer token for `/api/cron/billing` endpoint |

## Development

```bash
npm install
npm run dev
```

Open http://localhost:3000

### Run Tests

```bash
npm test              # run all tests (221 at last count)
npm run test:watch    # watch mode
npm run test:coverage # with coverage report (80% thresholds enforced)
```

### Project Structure

```
src/
├── app/
│   ├── (app)/          # Authenticated pages
│   │   ├── dashboard/      # At-a-glance home (stats + activity preview + subs preview)
│   │   ├── subscriptions/  # Subscription catalog (list, create, detail)
│   │   ├── activity/       # Everything happening: Action needed / Incoming / Updates
│   │   ├── settlement/     # Mark settled workspace (Unpaid / Paid toggle)
│   │   ├── friends/        # People you share subs with
│   │   └── settings/       # Profile, preferences, sign out
│   ├── (auth)/         # Login, register
│   └── api/            # API routes
├── components/         # Shared UI components
├── db/                 # Schema, migrations, DB connection
├── lib/                # Business logic
│   ├── billing.ts          # Pure calculation functions (shares, pro-rata, FX)
│   ├── db-operations.ts    # Database CRUD + subscription_members / membership rules
│   ├── settlement.ts       # Pair-level netting (unpaid + paid history)
│   ├── notifications.ts    # Notification CRUD + unread count
│   ├── api-handlers.ts     # Request-shaped business logic
│   ├── auth.ts             # Registration, login
│   ├── session.ts          # HMAC-signed cookie sessions
│   ├── validators.ts       # Zod input schemas
│   └── rate-limit.ts       # Login rate limiting
└── __tests__/          # 221 tests across billing, db-ops, settlement, API handlers
```

## API (subscription-centric)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET / PUT | `/api/auth/me` | Current user / update profile |
| GET | `/api/dashboard` | Monthly spending + pending bills |
| GET / POST | `/api/subscriptions` | List / create subscriptions (accepts `members[]` + `payerId`) |
| GET / PUT / DELETE | `/api/subscriptions/[id]` | Subscription CRUD (PUT routes price changes via R5 rewrite) |
| POST / DELETE | `/api/subscriptions/[id]/members[/[userId]]` | Add / remove / leave a subscription |
| PUT | `/api/subscriptions/[id]/payer` | Transfer payer to another member |
| PUT | `/api/billing/[id]/paid` | Mark a single bill paid |
| GET | `/api/settlement?view=unpaid\|paid` | Pair-netted outstanding balances / history |
| POST | `/api/settlement` | Mark a pair×currency bucket settled (body: counterpartyUserId + currency) |
| GET | `/api/friends` | Friend list (auto-formed when someone is added to a sub) |
| GET | `/api/notifications` | In-app feed with unread count |
| PUT | `/api/notifications/[id]/read` / `/api/notifications/read-all` | Mark read |
| GET | `/api/exchange-rate` | FX rate lookup |
| GET | `/api/icons` / `/api/icons/popular` | Icon manifest lookup |
| POST | `/api/cron/billing` | Advance billing cycles + run monthly R1 pass (protected by `CRON_SECRET`) |

## How It Works

1. **Add a subscription** and select the friends sharing it + who pays. Friendship edges auto-form when you add someone.
2. The **payer** (default: creator, re-assignable) is whose card gets charged. On the 1st of each month, cron generates one bill per non-payer member.
3. **Mid-month join** triggers an immediate pro-rata bill covering the remaining days — actionable right away or bundled with the next settlement.
4. **Settlement** on the 1st: one net transfer per counterparty per currency. Transfer via WeChat / bank / Venmo / etc., then click **"Mark settled"** to flip the whole bucket to paid.
5. **Price changes** rewrite current-month unpaid bills to the new price; already-paid bills aren't touched.
6. Nothing moves through SubShare — it's a tracker, not a payment processor.

## License

MIT

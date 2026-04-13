# SubShare

Split subscription costs with friends. Self-hosted, minimal, mobile-friendly.

## Features

- **Personal subscriptions** — Track your own Netflix, Spotify, iCloud, etc.
- **Shared subscriptions** — Create a group, invite friends, split costs equally
- **Dashboard** — See total monthly spending across all subscriptions
- **Billing** — Auto-generated bills for group members, one-click "Paid" to settle
- **Multi-currency** — Support for CNY, USD, HKD, CAD, EUR, GBP, JPY with real-time exchange rates
- **Pro-rated joining** — Members who join mid-cycle pay only for remaining days
- **Invite links** — Share a link to let friends join your group
- **Mobile + Desktop** — Bottom nav on mobile, sidebar on desktop

## Tech Stack

- **Framework**: Next.js 16 + TypeScript
- **UI**: shadcn/ui + Tailwind CSS
- **Database**: SQLite + Drizzle ORM
- **Auth**: HMAC-signed session cookies
- **Deployment**: Docker + Caddy (HTTPS)

## Quick Start (Docker)

```bash
git clone https://github.com/Davie521/subshare.git
cd subshare
docker compose up --build -d
```

Open **https://localhost** and register an account.

> Browser will warn about the self-signed certificate — click "Continue" to proceed.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_SECRET` | Yes (production) | dev fallback | HMAC signing key for session cookies (min 32 chars) |
| `DATABASE_URL` | No | `data/subshare.db` | Path to SQLite database file |
| `CRON_SECRET` | No | — | Bearer token for `/api/cron/billing` endpoint |

## Development

```bash
npm install
npm run dev
```

Open http://localhost:3000

### Run Tests

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

### Project Structure

```
src/
├── app/
│   ├── (app)/          # Authenticated pages (dashboard, groups, subscriptions, settings)
│   ├── (auth)/         # Login, register
│   ├── api/            # API routes
│   └── join/           # Invite link handler
├── components/         # Shared UI components
├── db/                 # Schema, migrations, DB connection
├── lib/                # Business logic
│   ├── billing.ts      # Core billing calculations
│   ├── db-operations.ts # Database CRUD operations
│   ├── api-handlers.ts # API business logic
│   ├── auth.ts         # Registration, login
│   ├── session.ts      # HMAC-signed cookie sessions
│   ├── validators.ts   # Zod input schemas
│   └── rate-limit.ts   # Login rate limiting
└── __tests__/          # 65 tests (billing, db-ops, API handlers)
```

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | Current user |
| GET | `/api/dashboard` | Monthly spending + pending bills |
| GET/POST | `/api/groups` | List / create groups |
| GET/DELETE | `/api/groups/[id]` | Group detail / delete |
| POST | `/api/groups/[id]/join` | Join via invite |
| POST | `/api/groups/[id]/leave` | Leave group |
| GET/POST | `/api/subscriptions` | List / create subscriptions |
| GET/PUT/DELETE | `/api/subscriptions/[id]` | Subscription CRUD |
| PUT | `/api/billing/[id]/paid` | Mark bill as paid |
| GET | `/api/exchange-rate` | Fetch FX rate |
| GET | `/api/icons` / `/api/icons/popular` | Icon manifest lookup |
| POST | `/api/cron/billing` | Advance billing cycles (protected) |

## How It Works

1. **Create a group** and share the invite link with friends
2. **Add subscriptions** to the group — costs are split equally
3. The **group creator is the payer** (the person whose card is charged)
4. Other members see **pending bills** on their dashboard
5. After transferring money (WeChat, bank, etc.), click **"Paid"** to mark as settled

## License

MIT

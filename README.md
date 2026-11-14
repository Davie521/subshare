# SubShare

Split subscription costs with friends. A self-hosted web app that records who is in which plan, what each person owes each month, and who has paid.

**Licence:** CC BY-NC-ND 4.0. Personal, non-commercial use only; no modification, no redistribution. See [License](#license).

**语言 / Language** → [English](README.md) · [中文](README.zh.md)

Netflix with the flat, Spotify with your sister, ChatGPT with the group. SubShare does the arithmetic, keeps the history, and shows everyone who has paid and who hasn't, so the group chat doesn't have to.

## Try it locally

You need Node 20 (the version CI and the Dockerfile use) and Docker for Postgres. This runs the app in development mode, fills the database with demo data, and signs you in without Google.

```bash
git clone https://github.com/Davie521/subshare.git
cd subshare
cp .env.example .env
```

Open `.env` and fill in the two empty secrets. Docker Compose refuses to start any service, Postgres included, while either is empty.

```bash
openssl rand -base64 48   # paste as SESSION_SECRET
openssl rand -hex 32      # paste as CRON_SECRET
```

Then:

```bash
docker compose up -d postgres
npm install
npm run dev
```

`npm run dev` first downloads service icons (see [External services](#external-services)), then serves http://localhost:3000. In a second terminal, add demo data. The seed script does not read `.env`, so pass the database URL inline:

```bash
DATABASE_URL=postgres://subshare:subshare@localhost:5432/subshare npm run seed
```

This creates 10 demo users with shared subscriptions and four months of bills. On an empty database the first user, Alice, has id 1. Sign in as her:

1. Open http://localhost:3000/api/dev/login?uid=1. It returns `{"ok":true,"userId":1}` and sets the session cookie.
2. Open http://localhost:3000/dashboard.

The dev login only works under `npm run dev`. In production builds, Docker included, it returns 404. The seed skips if any user already exists; `npm run seed:reset` (same `DATABASE_URL=` prefix) wipes every table first.

To sign in with your own Google account instead, fill in the Google variables in `.env` (see [Configuration](#configuration)).

## What it does

- **Personal and shared subscriptions in one place.** A shared one has a payer and a list of people who split it. You add people directly or send an invite link.
- **Shares are counted per day.** Each member pays for the days they were in the plan that month, so joining or leaving mid-month is prorated without extra steps.
- **Paid bills stay locked.** A price change takes effect from the date you set. If a join, leave or price change touches a month that was already paid, the difference becomes an adjustment folded into that member's next monthly bill.
- **One net amount per friend.** The Settlement page nets everything between you and each friend into one figure, in your currency or one you agreed with that friend, and lets you mark it settled.
- **Seven currencies with live rates:** CNY, USD, HKD, CAD, EUR, GBP, JPY.
- **Works on a phone.** Bottom tab bar on small screens, sidebar on desktop, light and dark themes.

## Run with Docker

```bash
docker compose up --build -d
```

This builds the app image and starts Postgres and the app on port 3000. Compose reads `SESSION_SECRET` and `CRON_SECRET` from `.env` and will not start without them. Inside the container `DATABASE_URL`, `PGSSLMODE=disable` and `NODE_ENV=production` are already set. The schema is created on the first request that touches the database.

The container runs in production mode, so the dev login is off and Google is the only way in. Compose passes `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `OAUTH_REDIRECT_URI` from `.env` into the container. Fill them in (see [Configuration](#configuration)) and add `http://localhost:3000/api/auth/google/callback` as an authorised redirect URI on your OAuth client. Compose starts without them, but sign-in then fails with `Missing env: GOOGLE_CLIENT_ID` in the server log.

Check the server is up with `curl http://localhost:3000/api/health`, which returns `{"status":"ok"}`. That endpoint does not touch the database.

For the author's Railway setup (Postgres plugin, GitHub Actions deploy), see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Configuration

All variables are in [`.env.example`](.env.example).

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | none | Postgres connection string. `.env.example` points at the compose Postgres on `localhost:5432`; compose sets its own value inside the container. |
| `SESSION_SECRET` | in production; compose always | dev: a built-in insecure value | Signs the session cookie. In production, requests that need a session fail while it is empty. Any non-empty value is accepted (length is not checked); use `openssl rand -base64 48`. |
| `CRON_SECRET` | for monthly billing; compose always | none | Bearer token for `POST /api/cron/billing`. Without it that endpoint returns 503. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google sign-in | none | An OAuth 2.0 client ID from Google Cloud Console → APIs & Services → Credentials. |
| `OAUTH_REDIRECT_URI` | for Google sign-in | none (`.env.example`: `http://localhost:3000/api/auth/google/callback`) | Must match an authorised redirect URI on that client, e.g. `https://your-domain.com/api/auth/google/callback`. |
| `APP_TIMEZONE` | no | `Asia/Shanghai` | IANA time zone for billing dates and the billing job's "today". An invalid value falls back to the default with a warning. |
| `PGSSLMODE` | no | unset: TLS is tried first | `disable` turns Postgres TLS off. Compose sets it for the bundled Postgres; leave it unset for a managed database. |

## External services

| Service | Used for | When it is down |
|---|---|---|
| Google OAuth | Sign-in | Nobody can sign in, except through the dev login. |
| [api.frankfurter.dev](https://api.frankfurter.dev) | Exchange rates. Each pair is cached in memory for 1 hour; requests time out after 3 seconds. | The last cached rate is used. With no cached rate, the Settlement page marks the total "FX incomplete". |
| icon.horse, DuckDuckGo and Google favicon endpoints | Service icons, fetched when `npm run dev`, `npm run build` or the Docker build runs | That service gets a generated letter icon; the build carries on. |

### Monthly billing needs an outside trigger

Monthly bills are created by `POST /api/cron/billing`. Nothing in the app or in `docker-compose.yml` calls it; without a caller, no monthly bills are generated. Call it on the 1st of each month in `APP_TIMEZONE`:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/billing
```

Calling it again in the same month does not create duplicate bills. The author's deployment uses [.github/workflows/cron-billing.yml](.github/workflows/cron-billing.yml), which runs at 00:05 UTC on the 1st and needs the repository secrets `CRON_SECRET` and `PROD_URL`.

## Limits

- **Google sign-in only.** There is no email/password account. Any verified Google account that can reach your instance can sign in and gets an account; there is no allowlist.
- **One instance.** The rate limiter and the exchange-rate cache live in process memory, so run a single replica.
- **Monthly bills need the outside trigger** described [above](#monthly-billing-needs-an-outside-trigger).

## Other docs

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Railway deployment, CI/CD workflows, GitHub secrets.
- [docs/DESIGN.md](docs/DESIGN.md): the UI design system (colours, type, spacing).

## Tech

Next.js 16 · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Postgres + Drizzle · Vitest

## License

[![License: CC BY-NC-ND 4.0](https://img.shields.io/badge/License-CC%20BY--NC--ND%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-nd/4.0/)

Released under [Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International](LICENSE) (CC BY-NC-ND 4.0).
Personal, non-commercial use only — no modification, no redistribution. For commercial or modification rights, contact `yj1722@ic.ac.uk`.

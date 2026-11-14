# Deployment — Railway

Railway auto-detects the `Dockerfile` at the repo root and builds from it. No `railway.json` / `nixpacks.toml` needed.

## One-time setup

1. **Create a new Railway project** → connect this GitHub repo. It will start a first build from `Dockerfile`.
2. **Add a Postgres plugin** → Railway → + New → Database → Postgres. This auto-injects `DATABASE_URL` into the app service's env.
3. **Set the remaining env vars** on the app service:

   | Variable | Value | How |
   |---|---|---|
   | `DATABASE_URL` | _(auto)_ | Injected by the Postgres plugin — don't set manually. |
   | `SESSION_SECRET` | 32+ char random string | `openssl rand -base64 48` locally, paste into Railway. **Required**, no dev fallback in production. |
   | `CRON_SECRET` | random token | Used by `POST /api/cron/billing`; share with whatever scheduler calls it. |
   | `NODE_ENV` | `production` | Usually auto-set by Railway. |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID. **Required**: Google is the only sign-in in production (the dev login returns 404). Without them sign-in fails with `Missing env: GOOGLE_CLIENT_ID`. |
   | `OAUTH_REDIRECT_URI` | `https://<your-domain>/api/auth/google/callback` | **Required** for sign-in. Must exactly match an authorised redirect URI on that OAuth client. |
   | `APP_TIMEZONE` | IANA zone, default `Asia/Shanghai` | Optional. Calendar dates for billing and the cron's "today". An invalid value falls back to the default with a warning. `cron-billing.yml` fires at 00:05 UTC on the 1st, which is already the 1st in `Asia/Shanghai`; in a zone west of UTC it is still the last day of the previous month, so move the schedule if you change this. |
   | `PGSSLMODE` | leave unset | Optional. Unset, the driver uses `ssl: 'prefer'` (TLS when the server offers it). Set `disable` only for a Postgres without TLS, e.g. the local compose one. |

4. **Redeploy** after setting vars.

## CI/CD (GitHub Actions)

All deployment goes through GitHub Actions — Railway's GitHub auto-deploy is **not** connected.

### Workflows (`.github/workflows/`)

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR | lint → typecheck → test → build |
| `deploy.yml` | push to `main` / manual dispatch | CI gate → `railway up` via CLI |
| `cron-billing.yml` | 1st of month UTC 00:05 / manual dispatch | `POST /api/cron/billing` |

`deploy.yml` reuses `ci.yml` as a reusable workflow (`workflow_call`), so CI logic lives in one place.

### GitHub Secrets required

| Secret | Purpose |
|---|---|
| `RAILWAY_TOKEN` | Railway **project token** (environment-scoped to production). Created in Railway → Project Settings → Tokens. |
| `CRON_SECRET` | Bearer token for `/api/cron/billing`. Must match the Railway env var. |
| `PROD_URL` | Production URL, e.g. `https://subshare-production.up.railway.app` (no trailing slash). |

### Manual redeploy

Go to GitHub → Actions → Deploy → "Run workflow" button (uses `workflow_dispatch`).

### Concurrency

`deploy.yml` uses `concurrency: { group: deploy-production, cancel-in-progress: false }` — rapid pushes queue instead of racing.

## Deployment constraints

Two hard rules from this codebase — don't break them:

1. **Single instance only.** `src/lib/rate-limit.ts` stores attempt counters in a per-process `Map`. Horizontal scaling splits counters across pods and defeats rate limiting. Keep replicas at 1. Before scaling out, swap to Redis-backed rate limiting.
2. **Long-running process required.** `handleCreateSubscription` fires background billing generation after returning the HTTP response. Serverless (Vercel/Lambda) kills the function when the response flushes — that work would be lost. Railway's container model is fine; don't migrate to FaaS without adding a queue first.

## Health check

The `Dockerfile` has a `HEALTHCHECK` hitting `/api/health`. Railway uses this to gate deploys — a red healthcheck blocks the new revision from taking over traffic.

## Secrets hygiene

- `.env` and `.env.local` are gitignored (every `.env*` except `.env.example`); never commit them.
- Rotate `SESSION_SECRET` means invalidating all existing sessions (users get logged out). Only rotate if suspected compromised.
- `CRON_SECRET` can be rotated freely — just update both Railway and the scheduler.

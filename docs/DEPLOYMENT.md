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

4. **Redeploy** after setting vars.

## Scheduling the monthly billing cron

`/api/cron/billing` needs to be hit on the 1st of each month. Railway doesn't have built-in cron, pick one:

- **Railway Cron Jobs** (beta, in project settings) — simplest
- External scheduler (GitHub Actions, cron-job.org, upstash QStash) calling the URL with `Authorization: Bearer $CRON_SECRET`

## Deployment constraints

Two hard rules from this codebase — don't break them:

1. **Single instance only.** `src/lib/rate-limit.ts` stores attempt counters in a per-process `Map`. Horizontal scaling splits counters across pods and defeats rate limiting. Keep replicas at 1. Before scaling out, swap to Redis-backed rate limiting.
2. **Long-running process required.** `handleCreateSubscription` fires background billing generation after returning the HTTP response. Serverless (Vercel/Lambda) kills the function when the response flushes — that work would be lost. Railway's container model is fine; don't migrate to FaaS without adding a queue first.

## Health check

The `Dockerfile` has a `HEALTHCHECK` hitting `/api/health`. Railway uses this to gate deploys — a red healthcheck blocks the new revision from taking over traffic.

## Secrets hygiene

- `.env.local` is gitignored; never commit it.
- Rotate `SESSION_SECRET` means invalidating all existing sessions (users get logged out). Only rotate if suspected compromised.
- `CRON_SECRET` can be rotated freely — just update both Railway and the scheduler.

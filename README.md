# SubShare

Split subscription costs with friends. Pre-paid monthly, mid-cycle prorate, per-pair netting, multi-currency. Self-hosted.

**Live demo** → https://subshare-production.up.railway.app
**语言 / Language** → [English](README.md) · [中文](README.zh.md)

## Features

- Personal and shared subscriptions in one place
- Mid-month join/leave auto-prorates the bill
- Price change rewrites the current cycle; paid bills stay locked
- Monthly per-pair netting — one transfer per friend per currency
- Multi-currency with live FX (CNY, USD, HKD, CAD, EUR, GBP, JPY)
- Mobile-first, dark mode, icon auto-fetch

## Quick Start

```bash
git clone https://github.com/Davie521/subshare.git
cd subshare
cp .env.example .env.local
docker compose up --build -d
```

Open **http://localhost:3000** and register.

## Tech

Next.js 16 · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Postgres + Drizzle · Vitest

## Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `SESSION_SECRET` | yes (prod) | HMAC session key, 32+ chars |
| `CRON_SECRET` | no | Bearer token for `/api/cron/billing` |

## Docs

- `docs/DEPLOYMENT.md` — Railway deployment
- `docs/DESIGN.md` — design system
- `CLAUDE.md` — architecture + billing rules

## License

[![License: CC BY-NC-ND 4.0](https://img.shields.io/badge/License-CC%20BY--NC--ND%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-nd/4.0/)

Released under [Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International](LICENSE) (CC BY-NC-ND 4.0).
Personal, non-commercial use only — no modification, no redistribution. For commercial or modification rights, contact `yj1722@ic.ac.uk`.

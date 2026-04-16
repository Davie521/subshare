# SubShare

和朋友分摊订阅费用。月度预付、中途按天折算、按人按币种汇总抵扣、多币种支持。自托管。

**在线 Demo** → https://subshare-production.up.railway.app
**语言 / Language** → [English](README.md) · [中文](README.zh.md)

## 功能

- 个人订阅和共享订阅统一管理
- 月中加入/退出按天自动折算
- 改价会重写当月未付账单；已付账单锁定
- 每月按人按币种净额结算，一笔转账搞定
- 多币种实时汇率（CNY、USD、HKD、CAD、EUR、GBP、JPY）
- 移动优先、深色模式、图标自动拉取

## 快速开始

```bash
git clone https://github.com/Davie521/subshare.git
cd subshare
cp .env.example .env.local
docker compose up --build -d
```

浏览器打开 **http://localhost:3000** 注册账号。

## 技术栈

Next.js 16 · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Postgres + Drizzle · Vitest

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | Postgres 连接串 |
| `SESSION_SECRET` | 生产环境必填 | Session cookie 的 HMAC key，≥32 字符 |
| `CRON_SECRET` | 否 | `/api/cron/billing` 的 Bearer Token |

## 文档

- `docs/DEPLOYMENT.md` — Railway 部署
- `docs/DESIGN.md` — 设计体系
- `CLAUDE.md` — 架构 + 账单规则

## 许可协议

[![License: CC BY-NC-ND 4.0](https://img.shields.io/badge/License-CC%20BY--NC--ND%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-nd/4.0/)

采用 [Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International](LICENSE)（CC BY-NC-ND 4.0）协议发布。
仅限个人、非商业用途——禁止修改、禁止再分发。如需商用或修改授权，请联系 `yj1722@ic.ac.uk`。

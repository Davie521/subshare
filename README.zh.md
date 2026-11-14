# SubShare

和朋友分摊订阅费。自己部署的网页应用，记下谁在哪个订阅里、每人每月该付多少、谁已经付了。

<img src="docs/screenshots/dashboard-mobile-demo-data.png" width="320" alt="手机上的 SubShare 首页（演示数据）：本月共 ¥675.09、13 个订阅、要和 4 个人结算，下面的动态里有 Emma 两笔账单欠你 ¥51.29。">

**许可协议：** CC BY-NC-ND 4.0。仅限个人、非商业用途，禁止修改、禁止再分发。详见[许可协议](#许可协议)。

**语言 / Language** → [English](README.md) · [中文](README.zh.md)

和室友合 Netflix，和妹妹合 Spotify，和一群人合 ChatGPT。SubShare 替你算账、留底，谁付了谁没付一目了然，不用再在群里一个个追。

## 本地试用

需要 Node 20（CI 和 Dockerfile 用的都是这个版本），以及用来跑 Postgres 的 Docker。下面以开发模式启动应用，往数据库里灌一份演示数据，不走 Google 直接登录。

```bash
git clone https://github.com/Davie521/subshare.git
cd subshare
cp .env.example .env
```

打开 `.env`，把两个空着的密钥填上。只要有一个是空的，Docker Compose 连 Postgres 都不肯启动。

```bash
openssl rand -base64 48   # 填进 SESSION_SECRET
openssl rand -hex 32      # 填进 CRON_SECRET
```

然后：

```bash
docker compose up -d postgres
npm install
npm run dev
```

`npm run dev` 会先下载订阅服务的图标（见[外部服务](#外部服务)），再在 http://localhost:3000 起服务。另开一个终端灌演示数据。灌数据的脚本不读 `.env`，数据库地址要写在命令前面：

```bash
DATABASE_URL=postgres://subshare:subshare@localhost:5432/subshare npm run seed
```

它会建 10 个演示用户、几个共享订阅和四个月的账单。数据库原来是空的话，第一个用户 Alice 的 id 是 1。用她登录：

1. 打开 http://localhost:3000/api/dev/login?uid=1，页面返回 `{"ok":true,"userId":1}`，同时写好登录 cookie。
2. 打开 http://localhost:3000/dashboard。

这个开发登录只在 `npm run dev` 下有效；生产构建（包括 Docker）里它返回 404。库里已经有用户时灌数据会直接跳过；`npm run seed:reset`（前面同样带 `DATABASE_URL=`）会先清空所有表。

想用自己的 Google 账号登录，就在 `.env` 里填上 Google 那几个变量（见[配置](#配置)）。

## 能做什么

- **个人订阅和共享订阅放在一起管。** 共享订阅有一个付款人和一份分摊名单。可以直接把人加进来，也可以发邀请链接。
- **按天算份额。** 每个成员只为当月在订阅里的那几天付钱，月中加入、退出自动按天折算，不用另外操作。
- **已付的账单不再改动。** 改价从你指定的那天起生效。加人、退出或改价碰到已经付过的月份时，差额记成一笔调整，并进该成员下个月的账单。
- **每个朋友只结一个净额。** 结算页把你和每个朋友之间的往来轧成一个数，用你的币种或你们约定的币种显示，可以直接标记已结清。
- **七种货币，实时汇率：** CNY、USD、HKD、CAD、EUR、GBP、JPY。
- **手机上也好用。** 小屏幕用底部标签栏，电脑上用侧边栏，有浅色和深色两种主题。

## 用 Docker 运行

```bash
docker compose up --build -d
```

这会构建应用镜像，启动 Postgres 和应用，端口 3000。Compose 从 `.env` 读 `SESSION_SECRET` 和 `CRON_SECRET`，缺了就不启动。容器里已经设好 `DATABASE_URL`、`PGSSLMODE=disable` 和 `NODE_ENV=production`。数据表在第一次访问数据库的请求时自动建好。

容器跑在生产模式，开发登录是关的，只能用 Google 登录。Compose 会把 `.env` 里的 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`OAUTH_REDIRECT_URI` 传进容器。把这三个填上（见[配置](#配置)），并在你的 OAuth 客户端里把 `http://localhost:3000/api/auth/google/callback` 加进授权重定向地址。不填也能启动，但登录会失败，服务端日志里是 `Missing env: GOOGLE_CLIENT_ID`。

用 `curl http://localhost:3000/api/health` 确认服务起来了，正常返回 `{"status":"ok"}`。这个接口不碰数据库。

作者在 Railway 上的部署方式（Postgres 插件、GitHub Actions 发布）见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 配置

全部变量都在 [`.env.example`](.env.example) 里。

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | 是 | 无 | Postgres 连接串。`.env.example` 指向 compose 起的 `localhost:5432`；容器里由 compose 另行设置。 |
| `SESSION_SECRET` | 生产环境必填；compose 始终要 | 开发环境有一个内置的不安全值 | 给登录 cookie 签名。生产环境下为空时，需要登录态的请求都会失败。代码只要求非空，不检查长度；建议用 `openssl rand -base64 48` 生成。 |
| `CRON_SECRET` | 月度账单要用；compose 始终要 | 无 | `POST /api/cron/billing` 的 Bearer Token。不设的话这个接口返回 503。 |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | Google 登录要用 | 无 | 在 Google Cloud Console → APIs & Services → Credentials 建的 OAuth 2.0 客户端。 |
| `OAUTH_REDIRECT_URI` | Google 登录要用 | 无（`.env.example` 里是 `http://localhost:3000/api/auth/google/callback`） | 必须和该客户端里登记的重定向地址一致，比如 `https://your-domain.com/api/auth/google/callback`。 |
| `APP_TIMEZONE` | 否 | `Asia/Shanghai` | 账单日期和月度任务判断「今天」所用的 IANA 时区。填错会退回默认值并打警告。 |
| `PGSSLMODE` | 否 | 不设：先尝试 TLS | 设成 `disable` 关闭 Postgres TLS。compose 给自带的 Postgres 设了；用托管数据库时别设。 |

## 外部服务

| 服务 | 用途 | 连不上时 |
|---|---|---|
| Google OAuth | 登录 | 除了开发登录，谁都登不进来。 |
| [api.frankfurter.dev](https://api.frankfurter.dev) | 汇率。每对货币在内存里缓存 1 小时，请求 3 秒超时。 | 用上一次缓存的汇率；没有缓存时，结算页的总额会标「FX incomplete」。 |
| icon.horse、DuckDuckGo 和 Google 的 favicon 接口 | 订阅服务图标，在 `npm run dev`、`npm run build` 或构建 Docker 镜像时下载 | 那个服务改用生成的字母图标，构建照常继续。 |

### 每月账单要靠外部触发

月度账单由 `POST /api/cron/billing` 生成。应用本身和 `docker-compose.yml` 都不会去调它；没人调，就不会生成月度账单。每月 1 号（按 `APP_TIMEZONE`）调一次：

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/billing
```

同一个月里重复调用不会生成重复账单。作者的部署用的是 [.github/workflows/cron-billing.yml](.github/workflows/cron-billing.yml)，每月 1 号 UTC 00:05 运行，需要仓库 secrets `CRON_SECRET` 和 `PROD_URL`。

## 限制

- **只能用 Google 登录。** 没有邮箱密码账号。任何通过验证的 Google 账号，只要访问得到你的实例，就能登录并自动建号，没有白名单。
- **只能跑一个实例。** 限流计数和汇率缓存都在进程内存里，只能开一个副本。
- **月度账单需要外部触发**，见[上文](#每月账单要靠外部触发)。

## 其他文档

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)：Railway 部署、CI/CD 工作流、GitHub secrets。
- [docs/DESIGN.md](docs/DESIGN.md)：界面设计规范（颜色、字体、间距）。

## 技术栈

Next.js 16 · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Postgres + Drizzle · Vitest

## 许可协议

[![License: CC BY-NC-ND 4.0](https://img.shields.io/badge/License-CC%20BY--NC--ND%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-nd/4.0/)

采用 [Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International](LICENSE)（CC BY-NC-ND 4.0）协议发布。
仅限个人、非商业用途——禁止修改、禁止再分发。如需商用或修改授权，请联系 `yj1722@ic.ac.uk`。

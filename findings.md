# Findings — 2026-04-16 Railway OAuth 回调 0.0.0.0 bug

## 根因（确定）

Next.js 16 standalone + 反向代理下，`NextRequest.url` 来自进程 bind 地址，不读 `X-Forwarded-*`。

- Dockerfile：`ENV HOSTNAME=0.0.0.0`
- Railway 注入：`PORT=8080`
- 容器内 Next server 监听 `0.0.0.0:8080`
- 请求经 edge 转发到容器，`req.url = http://0.0.0.0:8080/...`
- `new URL('/dashboard', req.url)` → `http://0.0.0.0:8080/dashboard`
- 302 Location 回浏览器 → Safari 拦 `0.0.0.0`（WebKitErrorDomain:103）

## OAuth redirect_uri 为什么不受此影响

`src/lib/oauth-google.ts:11`：`new Google(clientId, secret, process.env.OAUTH_REDIRECT_URI)` —— arctic 直接把这个 env 作为 redirect_uri 参数传给 Google，不走 `req.url`。所以 Google 能正确把用户送回 Railway edge → 容器里 callback 成功执行 → 在 callback **内部**再跳 `/dashboard` 才踩到坏 origin。

## 受影响位点清单

`src/app/api/auth/google/callback/route.ts`：
- 14 `new URL('/login?error=rate_limit', req.url)`
- 23 `new URL('/login?error=oauth_denied', req.url)`
- 27 `new URL('/login?error=invalid_request', req.url)`
- 40 `new URL('/login?error=state_mismatch', req.url)`
- 44 `new URL('/login?error=missing_verifier', req.url)`
- 56 `new URL('/login?error=email_not_verified', req.url)`
- 107 `new URL('/dashboard', req.url)` ← 用户踩到的
- 109 `new URL('/login?error=oauth_failed', req.url)`
- 17 `new URL(req.url)` ← **不动**（只读 query）

`src/middleware.ts:66`：
- `new URL('/login', req.url)` ← 未登录访问受保护路由也会踩同一个坑

`src/app/api/auth/google/route.ts:38`：
- `NextResponse.redirect(url.toString())` ← 不动（url 是 Google 的 OAuth URL，不是 app URL）

## 方案 A 的 12 条隐藏坑位

| # | 风险 | 处理 |
|---|------|------|
| 1 | `X-Forwarded-Host` 可伪造 → open redirect | Railway edge 覆盖；只跳同站路径，最差钓鱼页 |
| 2 | `X-Forwarded-Proto` 多级代理 CSV | `firstCsv()` |
| 3 | `X-Forwarded-Host` 同上 | `firstCsv()` |
| 4 | host 带/不带端口 | Railway edge 给裸域名 `https` 默认 443，OK |
| 5 | `new URL(path, base)` 要求 base 完整 | 模板字符串保证 |
| 6 | Middleware Edge Runtime | `NextRequest.headers.get` Edge 支持 ✓ |
| 7 | Cookie 域跨 host 丢失 | 目的就是还原同一 host，不会跨 |
| 8 | Next.js 16 内置 trust proxy？ | 没有。手写 helper 是标准做法 |
| 9 | **req.url fallback 在 Railway 还是坏** | `isBadHost()` 拒绝 `0.0.0.0` |
| 10 | Dev 兼容 | fromReq 分支处理 |
| 11 | `x-forwarded-port` 非标准端口 | Railway 不涉及，不处理 |
| 12 | 测试 mock NextRequest | `new Request(url, {headers: new Headers({...})})` |

## 待调研

- [ ] Railway 实际发送的 forwarded header 名（99% 是标准 `X-Forwarded-*`，走 Phase 1 一次就验证）
- [ ] Next.js 16 是否有官方推荐做法（读 `node_modules/next/dist/docs/` 里 proxy 相关段落）

## 次要观察

- `OAUTH_REDIRECT_URI` 在 Railway 上必为 `https://subshare-production.up.railway.app/api/auth/google/callback`（否则 Google 就拦了 OAuth）——所以"从它推 origin"永远安全，当兜底不会错
- 本地 dev 直连 3000，无 proxy，`req.url` 本身是 `http://localhost:3000`，所以这个 bug 在本地看不到
- 截图 URL 尾巴 `#` 是片段，可能是 app 之前一次登录成功后留下的路由 hash，与本次 bug 无关

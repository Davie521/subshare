# 任务计划 — 2026-04-16 Railway 生产 OAuth 回调落到 0.0.0.0:8080 修复

## 现象

- 生产 `https://subshare-production.up.railway.app/login` 点 Google 登录
- Google 认证后 302 到 `https://0.0.0.0:8080/dashboard#`
- Safari 拦：`WebKitErrorDomain:103 Not allowed to use restricted network port`
- 本地 dev `localhost:3000` 正常

## 根因

Next.js standalone 在 Railway 容器里 `req.url` = `http://0.0.0.0:8080/...`（来自进程 bind，不读 `X-Forwarded-*`）。`src/app/api/auth/google/callback/route.ts:107` 的 `new URL('/dashboard', req.url)` 继承坏 origin → 302 到 `0.0.0.0:8080` → Safari 拦。

OAuth 本身正常（redirect_uri 来自 `OAUTH_REDIRECT_URI` env）——bug 只在 callback 内部的二次 redirect 和 middleware 的未登录重定向。

## 受影响位点

- `src/app/api/auth/google/callback/route.ts` 行 14 / 23 / 27 / 40 / 44 / 56 / 107 / 109（`route.ts:17` 只读 query，不动）
- `src/middleware.ts:66`

共 9 处。

## 修复方案（方案 A 改进版）

### 新 helper：`src/lib/request-url.ts`

```ts
import type { NextRequest } from 'next/server'

function firstCsv(h: string | null): string | null {
  if (!h) return null
  return h.split(',')[0]?.trim() || null
}

function isBadHost(host: string): boolean {
  return /^0\.0\.0\.0(:|$)/.test(host)
}

export function resolveRequestUrl(req: NextRequest, path: string): URL {
  const proto = firstCsv(req.headers.get('x-forwarded-proto'))
  const fwdHost = firstCsv(req.headers.get('x-forwarded-host'))
  const host = fwdHost ?? req.headers.get('host')

  if (proto && host && !isBadHost(host)) {
    return new URL(path, `${proto}://${host}`)
  }

  const fromReq = new URL(path, req.url)
  if (!isBadHost(fromReq.host)) return fromReq

  // 最后兜底：从 OAUTH_REDIRECT_URI 推公网 origin（生产必配）
  const redirect = process.env.OAUTH_REDIRECT_URI
  if (redirect) {
    return new URL(path, new URL(redirect).origin)
  }

  return fromReq
}
```

### 三场景走位验证

| 场景 | forwarded-* | req.url | 走到 |
|------|-------------|---------|------|
| 本地 dev | 无 | `http://localhost:3000/...` | fromReq（host=localhost） |
| Railway 正常 | `https`,`subshare-...railway.app` | `http://0.0.0.0:8080/...` | 主路径 |
| Railway 异常（header 没转发） | 无 | `http://0.0.0.0:8080/...` | OAUTH_REDIRECT_URI 兜底 |

### 替换 9 个位点

所有 `new URL(path, req.url)` → `resolveRequestUrl(req, path)`。

### 测试：`src/__tests__/request-url.test.ts`

5 个 case：
1. 无 header + localhost → fromReq 分支
2. 带 x-forwarded-* + Railway 容器坏 req.url → 主路径
3. 无 header + req.url 坏 + 有 OAUTH_REDIRECT_URI → 兜底
4. CSV header `https,http` → 取 https
5. 无任何可用来源 → fromReq

## 阶段

- [ ] **Phase 1**：写 helper + 改 9 位点 + 单测
- [ ] **Phase 2**：`npm run dev` + `npm test` + `npm run lint` + `npm run build`
- [ ] **Phase 3**：走 cpr 流程（commit → PR → CI → merge → Railway 部署）+ 生产登录验证

## 风险

- **Open redirect（低风险）**：`X-Forwarded-Host` 理论可伪造，但 Railway edge 覆盖它；且 helper 只构造同站路径（`/dashboard` / `/login?...`），最差情况是钓鱼页，不是账号接管。后续可加 `ALLOWED_HOSTS` 白名单。
- **Dev 回归**：本地没 forwarded header，走 fromReq，等价原行为，不会回归。
- **Middleware Edge Runtime 兼容**：`NextRequest.headers.get` Edge 支持，无问题。

## 范围外

- 不改 Dockerfile（`HOSTNAME=0.0.0.0` 对 Railway 是必须的）
- 不加新 env var（helper 够用）
- 不加 host 白名单（下次 PR）
- 不动 OAuth 流程本身、session、cookie

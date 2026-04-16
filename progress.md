# 进度日志 — Railway OAuth 回调 0.0.0.0 bug

## 2026-04-16

### 起点
- 用户截图：生产 Google 登录 → Safari 错误页 `https://0.0.0.0:8080/dashboard#`
- 初判：以为 URL 输错；用户澄清："https://subshare-production.up.railway.app/login 这里 不行 本地ok"

### 根因定位
- `grep NextResponse.redirect` + `grep new URL(.*req.url)` → 10 个位点（callback 9 + middleware 1）
- 读 Dockerfile：`HOSTNAME=0.0.0.0`；Railway 注入 `PORT=8080`
- 推理：Next standalone 的 `req.url` 用进程 bind，不读 `X-Forwarded-*` → `new URL('/dashboard', req.url)` 继承坏 origin
- OAuth 能跑因为 redirect_uri 走 `OAUTH_REDIRECT_URI` env，不经 `req.url`

### 方案讨论
- A: 读 `x-forwarded-*`，fallback `req.url`
- B: 从 `OAUTH_REDIRECT_URI` 推 origin
- C: 加 `APP_URL` env
- **选 A**：无新 env、dev/prod 自适应、一个 helper 覆盖所有位点

### 深度分析方案 A
- 识别 12 条隐藏坑（开放重定向、CSV header、Edge runtime、fromReq fallback 也坏 等）
- 改进：加 `isBadHost` 守卫 + OAUTH_REDIRECT_URI 作为第三层兜底
- 确认 middleware 的 Edge runtime 兼容 `NextRequest.headers.get`

### 状态

- [x] 根因定位
- [x] 方案选型（A 改进版）
- [x] 写好 3 份规划文件
- [ ] **Phase 1**：等用户确认后实施（helper + 9 位点替换 + 单测）
- [ ] Phase 2：本地验证
- [ ] Phase 3：cpr 部署 + 生产验证

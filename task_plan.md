# 任务计划 — 链接邀请功能（Link-based Invites）

## 目标

让订阅创建者生成一个 URL，任何人点开 → Google 登录（新用户首次注册）→ 自动加入订阅 → 开始分摊。

## 当前状态

- 基础设施齐全：Google OAuth ✓、auto-friendship ✓、`addMemberToSubscription` ✓
- 缺：邀请 token 表、邀请路由、邀请落地页、OAuth state 里透传 token 的钩子

## 分阶段实施

### Phase 1 — 数据层（约 1 commit）
- [ ] 在 `src/db/schema.ts` 新增 `invites` 表：
  - `token` (text, unique, random 32 chars)
  - `subscriptionId` (FK cascade)
  - `inviterId` (FK users)
  - `expiresAt` (ISO, 默认 +7 天)
  - `maxUses` (int, null = 无限)
  - `usedCount` (int default 0)
  - `revokedAt` (ISO nullable)
- [ ] 在 `src/db/migrate.ts` 加对应 `CREATE TABLE IF NOT EXISTS`
- [ ] 更新 `docs/CLAUDE.md` 架构段落提到新表

### Phase 2 — 后端路由（约 2 commits）
- [ ] `POST /api/subscriptions/[id]/invites` — 创建邀请
  - 权限：仅订阅 member 可创建
  - 返回：`{ token, url, expiresAt }`
  - 速率限制：每用户每分钟 10 次
- [ ] `GET /api/invites/[token]` — 获取邀请元数据（公开，不需登录）
  - 返回：订阅名、logo、inviter 名、是否过期
- [ ] `POST /api/invites/[token]/accept` — 登录后接受
  - 校验：token 有效、未过期、未超 maxUses、用户不在 sub 里
  - 执行：`addMemberToSubscription` + `usedCount++`
  - 返回：`{ subscriptionId }` 便于前端跳转

### Phase 3 — 邀请落地页（约 1 commit）
- [ ] 新建 `src/app/invite/[token]/page.tsx`（注意：**不在** `(app)` 分组，因为要支持未登录访问）
  - 未登录 → 显示订阅卡片 + "Sign in with Google to join"，CTA 点击跳 `/api/auth/google?invite={token}`
  - 已登录 → 直接调 `POST /api/invites/[token]/accept` → 跳 `/subscriptions/{id}`

### Phase 4 — OAuth 透传 invite token（约 1 commit）
- [ ] `src/app/api/auth/google/route.ts` 读取 `?invite=` query
- [ ] 把 invite token 塞进 OAuth `state`（和 CSRF state 一起 base64 编码）或塞进 httpOnly cookie
- [ ] `src/app/api/auth/google/callback/route.ts` 登录成功后检查是否有 pending invite → auto-accept

### Phase 5 — 前端触发点（约 1 commit）
- [ ] `src/app/(app)/subscriptions/[id]/page.tsx` 加 "Invite" 按钮
  - 点击 → 调 create-invite API → 显示 Modal：链接 + 复制按钮 + 二维码（可选）
- [ ] `new/page.tsx` 的 "Email invites coming soon" 替换成 "After creating, share the invite link"

### Phase 6 — 测试（约 1-2 commits）
RED/GREEN 对：
- [ ] `invites.test.ts` — 创建 / 过期 / maxUses / revoke
- [ ] `invite-accept.test.ts` — 成功接受、重复接受（no-op）、自接受、已离开用户重新加入
- [ ] `invite-oauth-flow.test.ts` — state 透传、登录后自动 accept

### Phase 7 — 验证
- [ ] 本地：A 用户创建 sub 并生成邀请 → 无痕浏览器打开链接 → Google 登录（新账号）→ 自动加入 sub → dashboard 显示
- [ ] Railway 部署后重复一次端到端

## 决策（2026-04-16 用户确认）

1. **邀请范围**：针对单个订阅（auto-friendship 顺带）
2. **过期时间**：7 天（硬编码，不做成可配置）
3. **maxUses**：1（单次使用）
4. **中转页**：不做，直接跳 Google 登录 → 登录成功后自动 accept → 跳 `/subscriptions/{id}`

## 简化影响

- Phase 3（邀请落地页）简化为：`/invite/[token]` 直接重定向到 `/api/auth/google?invite={token}`，不渲染 UI
- Schema 里 `maxUses` 可以直接默认 1，不暴露给 UI
- 不需要 "revoke" 按钮（7 天自然过期 + 单次用完即废）—— 但数据库字段保留以备未来

## 不做的事

- 不做 email 邀请（需要 SMTP / SES 集成，额外基础设施）
- 不做 SMS 邀请
- 不改动 `friendships` 表的语义
- 不做 "邀请待审批"（owner 审核）—— token 本身就是授权凭证

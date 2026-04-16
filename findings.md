# Findings — Invitation feature audit (2026-04-16)

## Question
是否已实现 "分享链接邀请别人使用 APP" 的功能？

## 答案：**未实现**。只有内部 "加已有用户进订阅" 的部分脚手架。

## 代码证据

### 1. UI 明确说 "即将推出"
`src/app/(app)/subscriptions/new/page.tsx:442-443`
```tsx
No friends yet — add someone to your first shared
subscription from an existing one. (Email invites
coming soon.)
```

### 2. 数据库 schema 里没有 `invites` 表
`src/db/schema.ts` —  users / subscriptions / subscription_members / friendships / notifications / billing_records / categories / circles / circle_members — 全部清单中 **无 invites / invitations / invite_tokens**。

### 3. API 只接受 userId（已注册用户）
`src/app/api/subscriptions/[id]/members/route.ts:13-15`
```ts
const addMembersSchema = z.object({
  members: z.array(z.number().int().positive()).min(1).max(50),
})
```
userId 是 integer —— 陌生人（未注册）根本无法被添加。

### 4. "friendship" 自动形成是唯一的社交路径
`src/lib/db-operations.ts:127-129`
```ts
// Auto-create friendship between inviter and invitee (T7).
// Self-adds (owner-insert) produce no friendship.
if (input.addedBy !== input.userId) {
```
流程：A 把 B 加进订阅 → 自动建 friendship → B 在 A 的 friends 里出现。
**前提：B 必须已经在系统里。** 新用户无路可走。

### 5. 整个 codebase 搜 `invit|invite`（大小写不敏感）→ 6 处命中
- `src/lib/db-operations.ts` — 变量名 `invitees`（已注册用户 ID 数组）
- `src/lib/api-handlers.ts` — 同上
- `src/app/(app)/subscriptions/new/page.tsx` — "Email invites coming soon" 占位文案
- 3 个测试文件 — 测的都是内部添加
**没有一个** 是 token、link、magic URL、accept 流程。

## 结论性架构缺口

要实现 "一个链接就能邀请别人用 APP"，需要新建：

1. **新表** `invites`：token、subscription_id、inviter_id、expires_at、max_uses、used_count、created_at
2. **新路由**
   - `POST /api/subscriptions/[id]/invites` — 创建邀请，返回 `https://.../invite/{token}`
   - `GET /invite/[token]` — 邀请落地页（显示订阅信息 + "登录以加入" CTA）
   - `POST /api/invites/[token]/accept` — 登录后按这个接口入队
3. **登录流程衔接**
   - 未登录访问 `/invite/{token}` → 跳 `/login?invite={token}`
   - Google OAuth 回调把 `invite` 参数透传回来（state 里带）→ 登录成功自动 accept
4. **前端 UI**
   - 订阅详情页加 "邀请" 按钮 → 复制链接 / 二维码
   - 新用户 onboarding 页（显示 "你被 X 邀请加入 Y 订阅"）

## 与 Google OAuth 的依赖关系

**✓ 已就绪。** Google OAuth 刚修复上线（PR #9 + 昨天的 env 配置）。本地和 Railway 都能登录 —— 新用户通过邀请链接注册的那一步靠的就是 Google OAuth，链路已通。

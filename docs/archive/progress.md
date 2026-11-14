# 进度日志

## 2026-04-20 Shared 用户加 tag（personal tags）— 规划阶段

- 用户反馈：被分享的（非 owner 非 payer）用户在 subscription 详情页看不到
  tag 区域，完全没法加 tag。要求：被分享用户的"加"按钮必须产生 personal
  tag（仅本人可见）。
- Bug 定位完毕：
  - UI 门禁：`src/app/(app)/subscriptions/[id]/page.tsx:587` 整张 Tags
    Card 被 `{selfIsOwnerOrPayer && …}` 包住
  - API 门禁：`src/lib/api-handlers.ts:729` 对非 owner / 非 payer 返回
    403，错误串 "Only the owner or payer can edit tags or logo"
  - 模型不匹配：现有 `visibility: 'private'` 的语义是"owner + payer 可
    见"，不是"本人可见"。让 shared 用户写共享 tags 桶会破坏现有语义。
- 设计确定：**Option A — 每个 member 一个 personal_tags 桶**，存在
  `subscription_members.personal_tags JSONB`（PK 天然是 `(sub, user)`，
  一对一）。
- 方案写入 `findings.md` + `task_plan.md`，6 个 phase，每 phase 一对
  RED/GREEN commit（沿用 PR #13 tags 引入时的节奏）。
- 用户敲定：
  1. Owner/payer 也有 personal tags 桶（仅多人 sub）
  2. 列表页 (c) 合并 shared + personal，shared 在前，cap 5
  3. Rejoin 清空 personal_tags
  4. 上限 5
  5. **新增决定**：public/private 只在"分享中"有意义。
     - 1-member sub：Tags 卡片不显示 lock，新 tag 默认 private。
     - 1-member sub：不出现 "Your tags" 卡片（冗余）。
     - 多人 sub：两张卡片并存，语义不变。
- `task_plan.md` 已按新决定更新 Phase 4/5（TagEditor 改为
  `showVisibilityToggle` 布尔 prop；Phase 5 增加 list 页合并渲染步骤）。

## 2026-04-21 Personal tags — 实施完成

六个 Phase 全部 RED/GREEN 落地。累计 315/315 tests 通过（+27 新测），
lint 干净，`npm run build` 编译通过。

| Phase | RED | GREEN |
|---|---|---|
| 1. schema + migration | `d7eefe3` | `b4d9a67` |
| 2. validator + API 写入 + 三层权限 | `23d5a69` | `82cb155` |
| 3. handleGetSubscription 读取 | `d1dd194` | `bc59f80` |
| 4. TagEditor showVisibilityToggle + RTL | `30d6110` | `ca45f4b` |
| 5a. getSubscriptionsForUser.personalTags | `6b43503` | `cabfb11` |
| 5b. 详情页 "Your tags" + 列表页 merge | — | `6a13539` |
| 6. Rejoin 清空 | `b4eb144` | `23e6c25` |

顺带产物：
- 首批 React 组件 unit test（RTL @testing-library/react@16.3.2 +
  user-event@14.6.1），`.test.tsx` + 局部 jsdom 环境。
- 前置收尾 commit：`6d5ed58` fix(dashboard) 清掉上个任务的 saved by
  sharing 残留。

**UI 视觉验证待完成**：orbstack/docker 未启动，dev server 跑不起来。
需要开 orbstack 后 `npm run dev` 在浏览器里手动点一次：
- 多人 sub：主 Tags 卡片（owner/payer）带 lock；"Your tags" 卡片
  （每个 member）不带 lock
- 1-member sub：主 Tags 卡片不带 lock；"Your tags" 不出现
- 列表页：shared + personalTags 合并渲染（cap 5，显示 max 2 + "+N"
  overflow）
- Rejoin：踢人→再邀请，personal tags 清空

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
- **未动代码**。下一步进 Phase 1（schema + migration RED/GREEN）。

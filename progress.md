# 进度日志 — 2026-04-14/15 中途退订/踢人/删订阅账单重算

## 2026-04-15 回查 + 修复

- 回查发现 2 个 bug + 1 个测试缺口：
  - **Bug 1**（严重）：`prorateLeaverBill` 没按当前 stint 的 `addedAt` 过滤，
    rejoin 后再 leave 会把旧 stint 已锁定账单再缩一次。T12b 测试先写红，
    再修 `leaveSubscription` 传 `stintStart=row.addedAt`，
    `prorateLeaverBill` 的 SELECT 加 `billingDate >= max(stintStart, monthStart)`。
  - **Bug 2**（UX）：`bill_adjusted` 通知只写 DB，`NotificationType` 没注册、
    UI 没渲染器。补齐类型 + Icon + renderMessage；payload 加
    `delta_local_amount` + `local_currency` 让接收方按自己币种看金额。
- 继续处理 Q-C + Q-D：
  - **Q-C**：redistribute 的 `others` SELECT 显式 `ne(userId, payerId)`，
    不再单纯依赖 R8 不变量。
  - **Q-D**：`updateSubscriptionSchema` + `handleUpdateSubscription` + 详情页
    编辑表单 + `api-client.ts` 类型都加了 `refundPolicy`；新加一个
    `api.test.ts` 里的单测证明能切换。
- 最终：**232/232 tests pass · 0 lint errors · build OK**。

---


## 2026-04-14

- 重置计划文件。聚焦离场时的账单重算。
- 读了 `leaveSubscription`、`handleDeleteSubscription`、`billing.ts`。
- 初稿：scope、8 个问题、5 阶段计划、风险列表。
- Q&A 轮 1：用户答完 8 题，有两个歧义需确认（Q2 的 C 选项代价、Q4 的"一个月"含义）。
- Q&A 轮 2：用户最终决策：
  - Q2 → 创建时让创建者选 `refund_policy`
  - Q4 → 彻底删除最短承诺期，随时可退
- 计划更新完毕。准备进 Phase 0。

## 状态

- [x] Q&A 完成
- [x] Phase 0 — RED 测试（14 个）+ schema 加 `refund_policy` 列
- [x] Phase 1 — `calculateLeaveProRata` 原语（billing.ts）
- [x] Phase 2 — `leaveSubscription` 重写：按天重算账单 + redistribute 分摊 + 删最短承诺期 + rejoin 复用行
- [x] Phase 3 — `handleDeleteSubscription` 改成硬删 + CASCADE 清账单
  - 旧测试更新：soft-delete 案例改写为硬删，leave-subscription 最短承诺期断言更新，billing-invariants 动态计算 leave-prorate 后的预期值
  - 删除 `src/__tests__/minimum-cycle.test.ts`（规则已不存在）
  - **全套回归 221/221 pass**
- [x] Phase 4 — 创建订阅 UI 加 `refund_policy` 选择（两段卡片 radio，默认 `payer_absorbs`）
  - validators.ts + api-client.ts + handleCreateSubscription 全链路加 `refundPolicy` 字段
- [x] Phase 5 — CLAUDE.md R3/R4/R6/R7/R11 规则改写完
- [x] Phase 6 — 验证完成
  - `npm test` → 221/221 通过
  - `npm run lint` → 0 errors（39 warnings 都是老的，未触碰）
  - `npm run build` → 构建成功，standalone output 正常
  - 手动烟雾测试 pending（只有计算机终端，无浏览器验证）

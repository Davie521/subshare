# 任务计划 — 2026-04-14 中途退订/踢人/删订阅的账单重算

## 范围

把账单算法改成：成员中途离开时，**只按实际使用天数收费**。已付账单不动。

## 已对齐的决策（Q&A 完）

| # | 问题 | 决定 |
|---|------|------|
| Q1 | 按天退款公式 | `usage_days = leftAt_day − cycleStart`（退订当天不算使用）。R1 `cycleStart=1`，R2 `cycleStart=joinDate` |
| Q2 | 差额怎么处理 | **创建订阅时创建者选 refund_policy**：`'payer_absorbs'` 或 `'redistribute'` |
| Q3a | 最后一天退订 | 特例：`leftAt_day ≥ daysInMonth` → 整月收费 |
| Q3c | 月初 1 号退订 | `usage=0` → 账单直接删除 |
| Q4 | 最短承诺期 | **彻底删除**。随时可退，纯按天退款。踢人立即生效 |
| Q5 | 踢人 | 同一套按天退款公式 |
| Q6 | 删订阅 | 只有付款人能删。删 = 所有账单（含已付）全消 |
| Q7 | 重建同名 | 加测试证明是全新实体 |
| Q8 | 退订再加入 | 复用原成员行；当月旧账单（Q1 重算）+ 新 R2 pro-rata 账单分开两张 |

---

## 公式汇总

```
usage_days = leftAt_day − cycleStart                    // 默认
if leftAt_day ≥ daysInMonth:  usage_days = daysInMonth  // Q3a 特例
if usage_days ≤ 0:            DELETE the bill            // Q3c 特例
new_amount = floor(share × usage_days / daysInMonth)
new_localAmount = floor(localAmount × usage_days / daysInMonth)  // FX 锁定，按同比例缩
```

**refund_policy 分叉**（仅在 `usage_days` 导致 bill 缩水 Δ 时发生）：
- `'payer_absorbs'`：只改退订者自己的账单，其他人不变
- `'redistribute'`：把 Δ 平分给其他**未付**的非付款成员
  - 如果没有其他未付成员，退化为 `payer_absorbs`
  - 被摊的成员收到 `bill_adjusted` 通知

---

## Schema 变更

**新增**：
- `subscriptions.refund_policy TEXT NOT NULL DEFAULT 'payer_absorbs'`
  - 值：`'payer_absorbs' | 'redistribute'`

**删除**：
- `db-operations.ts:307-312` 的 `computeMinimumCycleEnd` 调用
- `computeMinimumCycleEnd` 函数本身（确认无其他调用者后）

迁移：旧订阅默认 `payer_absorbs`（对付款人最友好，改动最保守）。

---

## 阶段

### Phase 0 — 追踪 + RED 测试（先失败再实现）

新增文件：`src/__tests__/leave-prorate.test.ts`。覆盖场景：

1. **R1 成员自愿中途退订**（5/16 退，31 天月）→ 账单 `floor(share × 15 / 31)`
2. **R1 成员被踢中途**（5/16 踢）→ 同样公式
3. **R2 成员中途退订**（5/10 加入，5/20 退）→ `floor(share × 10 / 31)`
4. **已付账单不变**：退订前已付的历史账单金额锁定
5. **月初 1 号退订**（cron 已跑）→ 账单被删除
6. **最后一天退订**（5/31 退）→ 整月收费（`usage = daysInMonth`）
7. **payer_absorbs**：B 退订后 C 的账单不变
8. **redistribute + 其他人都未付**：Δ 平摊到 C 的账单
9. **redistribute + 其他人已付**：退化为 `payer_absorbs`
10. **删订阅清空账单**：所有账单（已付 + 未付）消失，订阅硬删除
11. **重建同名订阅**：新 sub id 不同，无成员/账单/通知继承
12. **退订再加入**：同一 `(sub, user)` 行被复用（`addedAt` 更新，`leftAt` 置 NULL）。当月两张账单共存（旧 pro-rata + 新 R2 pro-rata）
13. **最短承诺期已删除**：5/15 加入 + 5/16 退订 → 账单直接按 1 天 pro-rata（不再被推迟到 6/30）
14. **FX 缩放**：原 `localAmount` 按同比例缩小，`exchangeRate` 字段不变

### Phase 1 — billing.ts 新增原语

`calculateLeaveProRata(share, usage_days, daysInMonth) → bigint`
- 边界：`usage_days ≤ 0 → 0`；`usage_days ≥ daysInMonth → share`

### Phase 2 — 连到 `leaveSubscription`

`src/lib/db-operations.ts`：
- 删 `computeMinimumCycleEnd` 调用（及函数本身，grep 后确认）
- 设置 `leftAt` 之后：
  - 查当月该用户未付账单
  - 计算 `usage_days`
  - 如果 `usage_days ≤ 0` → DELETE 账单
  - 否则 UPDATE `amount` + `localAmount`
  - 根据 `refund_policy` 处理差额

### Phase 3 — 连到 `handleDeleteSubscription`

`src/lib/api-handlers.ts`：
- 删除"软删 vs 硬删"分叉
- 付款人点删除 → 所有 billing_records 先删、所有 subscription_members 先删、sub 本身硬删
- （表已有 `ON DELETE CASCADE`，sub 一删账单自动级联；但需要确认级联规则包含已付账单）

### Phase 4 — 创建订阅 UI 加 refund_policy 选择

`src/app/(app)/subscriptions/new/page.tsx`（仅 `mode === 'shared'` 时展示）：
```
┌─────────────────────────────────┐
│ 有人中途退订时…                │
│ ○ 由付款人吸收差额（推荐，简单）│
│ ○ 由其他成员分摊                │
└─────────────────────────────────┘
```
- 默认 `payer_absorbs`
- API: createSubscription 验证器加 `refundPolicy` 字段

### Phase 5 — 更新规则文档

CLAUDE.md：
- 重写 R3：中途退订/踢人按天退款，已付不退
- 新增 R11：`refund_policy` 的语义
- 删除 R7 里的最短承诺描述（如果有）
- 重写 R6（删订阅）：付款人删 = 全部账单清空

### Phase 6 — 验证
- `npm run lint` · `npm test` · `npm run build`
- 手动烟雾测试：3 人订阅、时间前进、中途退订、看账单

---

## 风险

- **FX 缩放精度**：`localAmount` 按 `usage_days / daysInMonth` 整数缩放，可能有 1 分钱误差，能接受。
- **redistribute + 并发退订**：如果两个人同一天退订，先后顺序影响被摊成员的最终金额。低概率，接受。
- **退订通知**：当前代码只在 kick 时发 `removed_from_sub` 通知；我们需要在 `redistribute` 时发 `bill_adjusted` 通知给被摊到的人（否则他们账单悄悄涨了）。
- **Q8 复用成员行**：需要小心 `addedAt` 语义。第二次加入覆盖 `addedAt` 后，旧账单的 "R1/R2 cycleStart" 怎么算？→ 旧账单已经按 Q1 重算过，锁定了，不再受 `addedAt` 影响。只有新账单用新 `addedAt`。

## 范围外

- 跨货币净额（R10 不变）
- 已付账单退款（用户明确排除）
- 按天退款在移动端的通知文案优化
- 改价格 + 退订同时发生的并发处理（按锁粒度接受）

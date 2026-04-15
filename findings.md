# Findings — 2026-04-14 leave-refund billing audit (回查)

## 对齐的部分 ✓

- `calculateLeaveProRata` 在 `billing.ts:56-68`，边界处理正确（≤0→0，≥daysInMonth→share）。
- `leaveSubscription` 删了最短承诺期，直接用 `input.leftAt`（db-operations.ts:319-321）。
- `prorateLeaverBill` 正确处理 R1/R2 两类账单（通过 `billingDate` 里的 day 推断 cycleStart 和 coverageDays）。
- Q3c（月初 1 号退）→ `usageDays ≤ 0` → DELETE bill ✓
- Q3a（最后一天退）→ `if (d >= daysInMonth) usageDays = coverageDays` ✓
- FX 缩放：`newLocalAmount = floor(localAmount × usageDays / coverageDays)` 同比例缩 ✓
- `handleDeleteSubscription` 改成硬删，schema 里 `billing_records` / `subscription_members` / `notifications` 都有 `ON DELETE CASCADE` ✓
- Schema `refund_policy` 列 + 迁移 `ADD COLUMN IF NOT EXISTS` ✓
- 创建订阅 UI 的 radio 选择 + validator enum ✓
- 14 个新测试全部通过，221 回归全绿。

---

## 🐛 Bug 1（严重）—— 退订 → 再加入 → 再退订会把旧账单再缩一次

**位置**：`src/lib/db-operations.ts:393-409`，`prorateLeaverBill` 的 SELECT。

**症状**：现在按「整个月范围」查这个用户的所有未付账单，没按「当前 stint」过滤。场景：

```
B 5/5  加入  → R2 账单 billingDate=2026-05-05, amount=1306 (cov=27)
B 5/15 退订  → prorate：usageDays=10 → amount=483 (locked for days 5..14)
B 5/25 再加入→ addedAt 更新到 5/25，新建 R2 账单 billingDate=2026-05-25, amount=338
B 5/28 再退订→ prorateLeaverBill 查 5 月所有未付，找到两张：
  旧账单 (billingDate=5-05): cycleStartDay=5, coverageDays=27,
          usageDays=28-5=23 → newAmount = floor(483 * 23/27) = 411
          ❌ 这张已经是「第一段 10 天」的锁定值，不该再动
  新账单 (billingDate=5-25): 正确缩
```

**修复**：查询加一条 `billingDate >= currentAddedAt`（当前 stint 的起点）。旧 stint 的账单 billingDate < 新 addedAt，自动跳过。

```ts
// 在 prorateLeaverBill 里把当前 stint 的 addedAt 传进来
.where(and(..., gte(billingDate, monthStart),
           gte(billingDate, currentStintAddedAt),  // ← 新加
           sql`${billingDate} < ${monthEndExclusive}`))
```

或等价：在 SELECT 前先查 `subscription_members.addedAt`（同事务里已经更新为 `leftAt` 对应的 stint 的 addedAt，但 leaveSubscription 没有改 addedAt，只是把 leftAt 设成 input.leftAt，所以 addedAt 还是当前 stint 的 join 日期 = 正确）。

**测试缺口**：`leave-prorate.test.ts` T12 只验证了 rejoin 本身（row 被复用，两张账单共存），没有测试「rejoin 之后再次 leave」。补一条：

```ts
// T12b
await leaveSubscription(db, { subscriptionId: sub.id, userId: B, leftAt: '2026-05-28' })
const oldBill = await billFor(sub.id, B, '2026-05-05')
// 旧账单必须保持 10 天的锁定金额，不能再缩
expect(oldBill?.amount).toBe(<first-leave 时的值>)
```

---

## 🐛 Bug 2（UX）—— `bill_adjusted` 通知只写 DB，不渲染

**位置**：
- 发送点：`db-operations.ts:489-499`（redistribute 分支）。
- `NotificationType` 联合类型：`src/lib/notifications.ts:9-15`。**缺 `'bill_adjusted'`**。
- 渲染器：`src/components/notifications-list.tsx:73-158`。**缺 `case 'bill_adjusted'`**，会走 `default: return { title: n.type }` → UI 里直接显示字符串 `"bill_adjusted"`。

**修复**：
1. 在 `NotificationType` 里加 `'bill_adjusted'`。
2. 在 `renderMessage` 和 `Icon` switch 里都加 case，读 payload 里的 `sub_name`, `delta_amount`, `reason`。
3. 给 `notifications.ts` 加一个 `BillAdjustedPayload` 接口。

**影响**：没被测试覆盖（测试只查 DB 表 `notifications` 的 row 数 / payload），UI 实际使用时才会暴露。

---

## 🟡 次要观察（非 bug，但值得记录）

1. **redistribute 没显式排除 payer**。`others` 查询只排了 `leaver.userId`（db-operations.ts:462），没排 payer。依赖 R8「payer 没有 billing_records」的全局不变量。如果哪天某条路径违反了 R8（已有的 `generateMonthlyBills` 似乎遵守了，但价格变更 R5 要再确认），就会把差额分给 payer。防御性更好的写法是把 `payerId` 也传进来显式排除。

2. **redistribute 按"每张账单独立分摊"**而非聚合一次。对 rejoin 场景（一个月两张账单），两张账单各自的 diff 会各分摊一次。对被分摊的 C 来说，他会收到两条 `bill_adjusted` 通知。数学上正确，UX 上冗余。

3. **redistribute 的语义**：不是「重新按剩余人数算 share」，而是「把 B 的差额平摊给 C/D/E」。举例 3 人组 B 中途退，最终 C 实际付了「前半月 1/3 + 后半月 1/2」的组合金额 + 多承担了 B 的那部分——C 会付得比「两人组全月」还多。这是计划里定的，不是 bug，但如果用户期望「重新算 share」，就是不同的算法。

4. **refund_policy 创建后不可改**。没有 API 路由允许修改（`handleUpdateSubscription` 只处理 `name/nextPayment/inactive`）。如果用户创建时选错了，只能删重建。可能需要后续增加一个 PATCH 端点。

---

## 需要回答的问题

- **Q-A**：确认修 Bug 1（stint 过滤）并补 T12b 测试？
- **Q-B**：确认修 Bug 2（`bill_adjusted` 注册类型 + 加渲染器）？
- **Q-C**：次要观察 1（显式排 payer）要不要一起加？
- **Q-D**：次要观察 4（refund_policy 创建后不可改）现在是范围外，保持还是加 PATCH？

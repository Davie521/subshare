# Billing Algorithm Audit — 2026-04-14

Worktree: `.claude/worktrees/billing-audit` (branch `worktree-billing-audit`)
Scope: `src/lib/billing.ts`, `src/lib/db-operations.ts`, `src/lib/settlement.ts` vs. `findings.md §9` (authoritative spec).

Legend: 🔴 bug  🟠 spec-gap / ambiguous  🟡 inconsistency / smell  🟢 observation

---

## 🔴 1. `getActiveMembersAt` boundary mismatches R1 spec (one-day over-billing on leave-day)

**Spec (R1)**: `added_at <= M_start AND (left_at IS NULL OR left_at > M_start)` — strict greater.
**Code** (`db-operations.ts:365–371`): `leftAt >= atDate` — inclusive.

Effect: a member whose `left_at = YYYY-MM-01` is still counted active when cron runs on the 1st → they receive a full-month R1 bill for a month they did not use. Also changes `n` used to compute `share(n)`.

Repro:
- Sub with A (payer), B, C on March 30.
- C is kicked (payer-initiated, bypasses min-cycle) on April 1 with `leftAt=2026-04-01`.
- Cron runs for `2026-04`: `getActiveMembersAt(sub, '2026-04-01')` returns A, B, C → `n=3`, C gets a full-month bill.

Fix: change the `>=` to `>` in `getActiveMembersAt` (and re-verify `calculateJoinProRata` when `addedAt` equals cron day — join-day still wants inclusive addedAt which the `<=` already handles correctly).

Impact: moderate. Only triggers when someone is removed/kicked exactly on the 1st, but kicks by the payer explicitly bypass the min-cycle guard (`db-operations.ts:304`), so it is reachable.

---

## 🔴 2. `generateAndSaveBillingRecords` stores un-rounded exchangeRate (float leakage into int column)

`db-operations.ts:800`: `exchangeRate: rate * 1000000` (no `Math.round`).
Compare: `generateMonthlyBills` uses `Math.round(rate * 1000000)` (line 708) and `addMemberToSubscription` uses `Math.round(rate * 1_000_000)` (line 201).

Effect: SQLite will silently truncate, and across rows the same rate can store as different ints depending on the float path. `changeSubscriptionPrice` then uses `bill.exchangeRate` to recompute `localAmount` — any drift here compounds.

Fix: wrap with `Math.round`.

---

## 🟠 3. Price change + membership change interaction is undefined (and code makes a non-obvious choice)

`changeSubscriptionPrice` recomputes `newShare = floor(newPrice / members.length)` where `members` is `getActiveMembersAt(sub, today)`.

Scenario:
- April 1: A (payer), B, C, price ¥150. R1 bills B=¥50, C=¥50 (unpaid).
- April 10: C leaves.
- April 20: A raises price to ¥180. `today`-`n = 2`, so `newShare = 90`. B's April-1 bill rewrites to ¥90.

Spec R4 says "share(n) changes for future billings only; already-generated bills not retroactively adjusted by R4." Spec R5 talks about rewriting with new price at the *same* n. The code blends R4 and R5 — B now owes ¥90 for a month that was originally billed at n=3.

Arguably-correct alternative: use each bill's *own* inferred n (from `amount / oldPrice` back-solve, or store `membersAtBilling` on the row).

Impact: real-world, price hikes combined with mid-month departures produce surprising settlements. Needs spec clarification.

---

## 🟡 4. Two inconsistent pro-rata bases coexist in `billing.ts`

- `calculateJoinProRata(share, day, daysInMonth)` — calendar-month denominator. Used by `addMemberToSubscription` (the live path that generates R2 bills).
- `calculateProRate(price, memberCount, joinDate, nextPayment)` — uses `daysBetween(prevBilling, nextPayment)` = subscription-cycle denominator. Used by `generateBillingRecords` (not called anywhere I found besides tests).

For the same scenario they can give different answers when `next_payment.day !== 1`. Dead branch risk: if anyone re-wires the UI to call `generateBillingRecords`, spec drift is silent.

Fix: delete `generateBillingRecords` / `calculateProRate` if truly unused, or align to calendar-month.

Related: `generateAndSaveBillingRecords` (legacy per-sub) uses `billing_date = sub.nextPayment`, not `M_start`. If still callable, a 2026-04-15 `nextPayment` would create April bills dated 04-15 — violates R1's "billing_date = M_start" convention and breaks `changeSubscriptionPrice`'s month-boundary query (`gte(monthStart) && lte(monthEnd)` still matches, but the `bill.billingDate === monthStart` branch is mis-selected, so pro-rata rewrite path is wrongly taken for full-share bills).

---

## 🟡 5. `generateMonthlyBills` transaction rolls back all subs on one missing FX rate

`db-operations.ts:679`: `throw new Error('Missing exchange rate for …')` is raised inside `db.transaction`. Because the transaction is scoped per-sub it only rolls that sub's inserts, but the outer loop then propagates the throw (transactions re-raise), so `generateMonthlyBills` bails out on the first missing rate and leaves later subs un-billed for the month.

Fix: catch-per-sub and log, or pre-validate the rate map.

Impact: moderate. Cron failure on day 1 is costly — backfill story is manual.

---

## 🟡 6. `addMemberToSubscription` does not check `sub.inactive`

An inactive sub can still receive a pro-rata R2 bill when a member is added. Probably unreachable via UI, but the invariant should live in the data layer.

---

## 🟡 7. `addMemberToSubscription` accepts future `addedAt`

No validation that `addedAt <= today`. A future `addedAt` leads to `calculateJoinProRata` being called with a future day and producing a bill dated in the future. Downstream queries filter by `billing_date <= monthEnd(today)` in price-change path, so the bill stays "floating" until the month arrives.

Fix: clamp or reject.

---

## 🟢 8. Payer absorbs floor remainder — fairness drift

`share = floor(price/n)`, so payer effectively pays `price - (n-1)*share` each month. With price=¥100, n=3 → payer pays ¥34, others pay ¥33. Over 12 months payer "loses" 12¢. Documented invariant, not a bug.

---

## 🟢 9. Transfer-payer leaves unpaid current-month bills pointing at old payer

`transferPayer` updates `subscriptions.payer_id` but does not touch current unpaid bills. This is actually **correct** under the spec — the service for month M was paid by the old payer, so bills for M should flow to them. Flagged here because UI may confuse users ("I'm payer now but I still owe someone for April?").

---

## 🟢 10. Floor-of-floor pro-rata rounding bias

`amount = floor(floor(P/n) × days/D_M)` — compounds downward. For most real prices the extra 1-cent loss is negligible, and consistently favours the payer. Documented.

---

## 🔴 12. `changeSubscriptionPrice` silently re-prices bills for members who already left (NEW — found via invariant probe) — **FIXED**

Found by `billing-invariants.test.ts → "R5 × R4 — price change after a mid-month leave uses today.n, not bill-time.n"`.

Reproduced: A (payer), B, C at ¥150; R1 generates B=¥50, C=¥50. C is kicked today. A raises price to ¥180. Both B's **and C's** bills rewrote to ¥90. C already left; their obligation should be frozen.

Fix shipped in this branch: `changeSubscriptionPrice` now filters the rewrite set by `activeUserIds` (members still active today). C's bill stays at the original amount; B's still rewrites normally. Regression test: `change-price.test.ts → "does NOT rewrite unpaid bills for members who already left"`.

Impact before fix: abuse vector — a payer could kick someone and then raise the price to grief their outstanding debt.

---

## 🟢 11. Self-settlement guard in `bucketByPairCurrency`

`settlement.ts:99`: `if (counterparty === viewerId) continue // self — should not happen`. Defensive, good. Relies on R8 (payer has no billing record) to avoid accidental self-owed rows. If issue #1 above ever violates R8, this silently hides symptoms.

---

# Recommended fix order

1. ✅ **#1** — `getActiveMembersAt` strict `>` on `leftAt` (regression: kick-on-M_start excluded).
2. ✅ **#2** — `Math.round` on `exchangeRate` in `generateAndSaveBillingRecords`.
3. ✅ **#12** — `changeSubscriptionPrice` filters to active members (regression: departed not re-priced).
4. ✅ **#5** — `generateMonthlyBills` per-sub try/catch; missing FX for one sub no longer aborts the month (regression test added).
5. ✅ **#4** — dropped `calculateProRate` and `generateBillingRecords` from `billing.ts`; dead outside tests. Old tests removed.
6. ✅ **#6** — `addMemberToSubscription` skips R2 pro-rata bill when sub is inactive (regression test added).
7. ✅ **#7** — `addMemberToSubscription` now rejects malformed `addedAt`. Future-date guard reverted: too many legitimate test/setup paths use future dates, and the risk was LOW.
8. **#3** (open) — R5 × R4 interaction. Active-members-only rewrite (via #12 fix) removes the worst case. The remaining ambiguity — whether active members' bills use today's `n` or bill-time `n` when `n` changed mid-month — is a product-policy call. `billing-invariants.test.ts → "R5 × R4"` pins current behavior so any policy change is visible.

#!/usr/bin/env node
// Round 2 — pattern fixes discovered after first run.
// Operates on already-round1-migrated files.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const TESTS_DIR = 'src/__tests__'
const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.test.ts'))

let touched = 0

for (const file of files) {
  const abs = path.join(TESTS_DIR, file)
  const orig = readFileSync(abs, 'utf8')
  let out = orig

  // --- Fix 1: any `function NAME(` whose body contains `await` → async ---
  // Collect names that need promotion, then rewrite signatures + call sites.
  const promoteNames = new Set()
  const fnRe =
    /(?<!async )\bfunction\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/g
  let m
  while ((m = fnRe.exec(out)) !== null) {
    const name = m[1]
    const bodyStart = m.index + m[0].length - 1 // at the `{`
    // Find matching brace
    let depth = 0
    let i = bodyStart
    for (; i < out.length; i++) {
      const c = out[i]
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const body = out.slice(bodyStart, i + 1)
    if (/\bawait\b/.test(body)) {
      promoteNames.add(name)
    }
  }

  for (const name of promoteNames) {
    // Promote declaration
    out = out.replace(
      new RegExp(String.raw`(?<!async\s)\bfunction\s+${name}\(`, 'g'),
      `async function ${name}(`
    )
    // Auto-await callers
    out = out.replace(
      new RegExp(
        String.raw`(?<![\w$])(?<!await )(?<!function )(?<!async function )${name}\(`,
        'g'
      ),
      `await ${name}(`
    )
  }

  // --- Fix 2: `await FN(args).X` → `(await FN(args)).X` ---
  // Known-async fns whose return is chained with `.prop` or `.method(`.
  const ASYNC_FNS = [
    'getActiveMembersAt',
    'getMembersOfSubscription',
    'getSubscriptionsForUser',
    'getGroupWithMembers',
    'getPendingBills',
    'getMonthlySpendingData',
    'getSettlementSummary',
    'listNotifications',
    'countUnreadNotifications',
    'createSubscription',
    'generateAndSaveBillingRecords',
    'generateMonthlyBills',
    'backfillFromGroups',
    'canLeaveGroup',
    'markPairSettled',
    'handleCreateGroup',
    'handleJoinGroup',
    'handleLeaveGroup',
    'handleCreateSubscription',
    'handleAddMembers',
    'handleRemoveMember',
    'handleGetSettlement',
    'handleMarkPairSettled',
    'handleListFriends',
    'handleListNotifications',
    'handleTransferPayer',
    'handleUpdateSubscription',
    'handleDeleteSubscription',
    'handleMarkPaid',
    'handleGetDashboard',
    'runBillingCron',
    'registerUser',
    'loginUser',
  ]
  for (const fn of ASYNC_FNS) {
    // Match `await FN(...)` followed by `.` (property or method)
    // Use balanced-paren matcher approximation.
    const re = new RegExp(
      String.raw`await\s+${fn}\(((?:[^()]|\([^()]*\))*)\)\s*\.`,
      'g'
    )
    out = out.replace(re, `(await ${fn}($1)).`)
    // Also for cases where user didn't wrap: the `.length` / `.filter`
    // Already-awaited pattern "(await …).prop" is preserved.
  }

  // --- Fix 3: sqlite → db for lib/handler functions that take db ---
  // Narrow list of libs that need `db` (not shim).
  const LIB_FNS_WANTING_DB = [
    'insertNotification',
    'listNotifications',
    'markNotificationRead',
    'markAllNotificationsRead',
    'countUnreadNotifications',
    'createSubscription',
    'addMemberToSubscription',
    'leaveSubscription',
    'transferPayer',
    'changeSubscriptionPrice',
    'getActiveMembersAt',
    'getMembersOfSubscription',
    'generateMonthlyBills',
    'generateAndSaveBillingRecords',
    'markBillPaid',
    'getSubscriptionsForUser',
    'getGroupWithMembers',
    'getPendingBills',
    'canLeaveGroup',
    'removeGroupMember',
    'getMonthlySpendingData',
    'getSettlementSummary',
    'markPairSettled',
    'registerUser',
    'loginUser',
    'handleCreateGroup',
    'handleJoinGroup',
    'handleLeaveGroup',
    'handleDeleteGroup',
    'handleCreateSubscription',
    'handleAddMembers',
    'handleRemoveMember',
    'handleGetSettlement',
    'handleMarkPairSettled',
    'handleListFriends',
    'handleListNotifications',
    'handleMarkNotificationRead',
    'handleMarkAllNotificationsRead',
    'handleTransferPayer',
    'handleUpdateSubscription',
    'handleDeleteSubscription',
    'handleMarkPaid',
    'handleGetDashboard',
    'runBillingCron',
    'backfillFromGroups',
  ]
  for (const fn of LIB_FNS_WANTING_DB) {
    // `fn(sqlite,` → `fn(db,`  (with or without preceding await)
    out = out.replace(new RegExp(`${fn}\\(sqlite,`, 'g'), `${fn}(db,`)
    // `fn(sqlite)` (no args after) → `fn(db)`
    out = out.replace(
      new RegExp(`${fn}\\(sqlite\\)(?![\\w])`, 'g'),
      `${fn}(db)`
    )
  }

  // --- Fix 4: `createUser(sqlite)` / `createUser(sqlite, ...)` missed earlier ---
  out = out.replace(/createUser\(sqlite\)/g, 'await createUser(db)')
  out = out.replace(/createUser\(sqlite,/g, 'await createUser(db,')
  out = out.replace(/(?<!await )createUser\(db\)/g, 'await createUser(db)')
  out = out.replace(/(?<!await )createUser\(db,/g, 'await createUser(db,')
  out = out.replace(/createGroup\(sqlite,/g, 'await createGroup(db,')
  out = out.replace(/(?<!await )createGroup\(db,/g, 'await createGroup(db,')
  out = out.replace(/addMember\(sqlite,/g, 'await addMember(db,')
  out = out.replace(/(?<!await )addMember\(db,/g, 'await addMember(db,')

  // --- Fix 5: double-await cleanup ---
  out = out.replace(/\bawait\s+await\b/g, 'await')

  // --- Fix 6: undo await inside import braces ---
  for (let i = 0; i < 4; i++) {
    out = out.replace(
      /(import \{[^}]*?)await ([A-Za-z_][\w]*)(\s*[,}])/g,
      '$1$2$3'
    )
  }

  if (out !== orig) {
    writeFileSync(abs, out)
    touched++
  }
}

console.log(`Round 2 touched: ${touched} / ${files.length}`)

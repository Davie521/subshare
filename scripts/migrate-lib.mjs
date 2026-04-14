#!/usr/bin/env node
// Convert src/lib/*.ts + src/app/api/**/route.ts from sync sqlite to async pg.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

const targets = [
  ...walk('src/lib'),
  ...walk('src/app/api'),
]

const ASYNC_FNS = [
  // db-operations (anything we export)
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
  'getPendingBills',
  'getMonthlySpendingData',
  // notifications
  'insertNotification',
  'listNotifications',
  'markNotificationRead',
  'markAllNotificationsRead',
  'countUnreadNotifications',
  // settlement
  'getSettlementSummary',
  'getSettledHistory',
  'markPairSettled',
  // auth
  'registerUser',
  'loginUser',
  // circles
  'createCircle',
  'listCirclesForOwner',
  'getCircle',
  'updateCircle',
  'deleteCircle',
  // api-handlers
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
  'handleCreateCircle',
  'handleListCircles',
  'handleGetCircle',
  'handleUpdateCircle',
  'handleDeleteCircle',
  'runBillingCron',
]

const boolFields = ['isPaid', 'autoRenew', 'inactive', 'notify', 'showEmail']

let touched = 0

for (const file of targets) {
  const orig = readFileSync(file, 'utf8')
  let out = orig

  // --- Import swap ---
  out = out.replace(
    /import type \{ BetterSQLite3Database \} from 'drizzle-orm\/better-sqlite3'\n/g,
    "import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'\n"
  )
  out = out.replace(
    /type DB = BetterSQLite3Database<typeof schema>/g,
    'type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>'
  )

  // --- Strip .get() / .all() / .run() (Drizzle sync terminals) ---
  // Only safe when followed by end-of-statement or simple chaining.
  // Use a heuristic: strip `.get()` at end of a multi-line expression.
  out = out.replace(/\.get\(\)\n/g, '\n')
  out = out.replace(/\.all\(\)\n/g, '\n')
  out = out.replace(/\.run\(\)\n/g, '\n')
  // Inline
  out = out.replace(/\.get\(\)(\s*[;,)\]}])/g, '$1')
  out = out.replace(/\.all\(\)(\s*[;,)\]}])/g, '$1')
  out = out.replace(/\.run\(\)(\s*[;,)\]}])/g, '$1')
  // At start of line (rare)
  out = out.replace(/^(\s*)\.get\(\)\s*$/gm, '')
  out = out.replace(/^(\s*)\.all\(\)\s*$/gm, '')
  out = out.replace(/^(\s*)\.run\(\)\s*$/gm, '')

  // --- Mark exported functions async + Promise return type ---
  // `export function foo(` → `export async function foo(`
  out = out.replace(/export function (\w+)\(/g, 'export async function $1(')
  // Internal named functions we want async (heuristic: contains await in body)
  // Collect fn signatures and promote those with await inside.
  const fnRe =
    /(?<!async )\bfunction\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/g
  const promoteNames = new Set()
  let fm
  while ((fm = fnRe.exec(out)) !== null) {
    const bodyStart = fm.index + fm[0].length - 1
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
    if (/\bawait\b/.test(body)) promoteNames.add(fm[1])
  }
  for (const name of promoteNames) {
    out = out.replace(
      new RegExp(String.raw`(?<!async\s)\bfunction\s+${name}\(`, 'g'),
      `async function ${name}(`
    )
  }

  // --- Return types: `: ReturnT` → `: Promise<ReturnT>` on async decls ---
  // Done via minimal pattern that matches `async function X(...): ReturnType {`
  // and if ReturnType doesn't start with Promise, wrap it.
  out = out.replace(
    /async function (\w+)\(([^)]*)\)\s*:\s*([^{]+?)\s*\{/g,
    (match, name, args, ret) => {
      const r = ret.trim()
      if (r.startsWith('Promise<') || r === 'void') return match
      return `async function ${name}(${args}): Promise<${r}> {`
    }
  )

  // --- Auto-await known async call sites ---
  for (const fn of ASYNC_FNS) {
    const re = new RegExp(
      String.raw`(?<![\w$])(?<!await )(?<!function )(?<!async function )${fn}\(`,
      'g'
    )
    out = out.replace(re, `await ${fn}(`)
  }
  // Undo accidental await in import braces
  for (let i = 0; i < 4; i++) {
    out = out.replace(
      /(import \{[^}]*?)await ([A-Za-z_][\w]*)(\s*[,}])/g,
      '$1$2$3'
    )
  }

  // --- Local fixture-like fns: make async if they contain await ---
  // (same as promoteNames loop above — already done)

  // --- Boolean literal fixes ---
  for (const f of boolFields) {
    out = out.replace(new RegExp(`\\b${f}:\\s*1\\b`, 'g'), `${f}: true`)
    out = out.replace(new RegExp(`\\b${f}:\\s*0\\b`, 'g'), `${f}: false`)
    out = out.replace(
      new RegExp(`(\\.${f},\\s*)1(\\s*\\))`, 'g'),
      '$1true$2'
    )
    out = out.replace(
      new RegExp(`(\\.${f},\\s*)0(\\s*\\))`, 'g'),
      '$1false$2'
    )
  }

  // --- `db.transaction((tx) =>` → `db.transaction(async (tx) =>` ---
  out = out.replace(
    /db\.transaction\(\(([a-z_][\w]*)\)\s*=>\s*\{/g,
    'db.transaction(async ($1) => {'
  )

  // --- Double-await collapse ---
  out = out.replace(/\bawait\s+await\b/g, 'await')

  // --- Fix db.select/... chain: prefix with await when assigned ---
  // `const X = db.` / `const X = tx.` assignments that no longer end in .get/.all/.run
  // need explicit await. Do this for `const|let|var X = (db|tx|getDb())` start.
  out = out.replace(
    /(\s)(const|let)\s+(\w+|\{[^}]*\}|\[[^\]]*\])\s*=\s*(db|tx)\.(select|insert|update|delete)\b/g,
    '$1$2 $3 = await $4.$5'
  )
  // `return db.` / `return tx.`
  out = out.replace(
    /(\s)return\s+(db|tx)\.(select|insert|update|delete)\b/g,
    '$1return await $2.$3'
  )
  // Undo double-await introduced
  out = out.replace(/\bawait\s+await\b/g, 'await')

  if (out !== orig) {
    writeFileSync(file, out)
    touched++
  }
}

console.log(`Touched: ${touched} lib/api files`)

#!/usr/bin/env node
// Mechanical migration of test files from better-sqlite3 sync API to pglite async.
// Strategy:
//   - Drop better-sqlite3 imports and variable types
//   - Replace them with types from the new helpers (which exposes a sqlite shim)
//   - Keep `sqlite` variable where used: helpers now return an async shim
//   - Make tests / beforeEach / local fixture fns async
//   - Auto-await known async library functions (db-operations, notifications, etc.)
//   - Auto-await sqlite.prepare(...).get()/.all()/.run() call sites
//   - Fix boolean literals (0/1 → false/true) on known bool fields

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const TESTS_DIR = 'src/__tests__'
const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.test.ts'))

const ASYNC_FNS = [
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
  'insertNotification',
  'listNotifications',
  'markNotificationRead',
  'markAllNotificationsRead',
  'countUnreadNotifications',
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
  'migrate',
]

const LOCAL_FIXTURE_RE =
  /(\s+)(async\s+)?function\s+(setup\w*|make\w*|seed\w*|create\w*(?:Fixture)?)\(/g

let touched = 0
const skipped = []

for (const file of files) {
  const abs = path.join(TESTS_DIR, file)
  const orig = readFileSync(abs, 'utf8')
  let out = orig

  // --- Imports cleanup ---
  out = out.replace(/^import Database from 'better-sqlite3'\n/gm, '')
  out = out.replace(/^import type Database from 'better-sqlite3'\n/gm, '')
  out = out.replace(
    /^import type \{ BetterSQLite3Database \} from 'drizzle-orm\/better-sqlite3'\n/gm,
    ''
  )
  out = out.replace(
    /^import \{ drizzle \} from 'drizzle-orm\/better-sqlite3'\n/gm,
    ''
  )

  // --- sqlite variable: replace type with shim type ---
  out = out.replace(
    /let sqlite: Database\.Database\n/g,
    "let sqlite: Awaited<ReturnType<typeof setupTestDb>>['sqlite']\n"
  )
  out = out.replace(
    /let db: BetterSQLite3Database<typeof schema>/g,
    "let db: Awaited<ReturnType<typeof setupTestDb>>['db']"
  )

  // --- beforeEach async wiring ---
  out = out.replace(
    /beforeEach\(\(\) => \{(\s*\n\s*)const setup = setupTestDb\(\)/g,
    'beforeEach(async () => {$1const setup = await setupTestDb()'
  )
  out = out.replace(
    /beforeAll\(\(\) => \{(\s*\n\s*)const setup = setupTestDb\(\)/g,
    'beforeAll(async () => {$1const setup = await setupTestDb()'
  )
  out = out.replace(
    /const setup = setupTestDb\(\)/g,
    'const setup = await setupTestDb()'
  )
  out = out.replace(
    /const \{ db, sqlite \} = setupTestDb\(\)/g,
    'const { db, sqlite } = await setupTestDb()'
  )
  out = out.replace(
    /const \{ db \} = setupTestDb\(\)/g,
    'const { db } = await setupTestDb()'
  )

  // --- sqlite → db on helper calls (createUser/createGroup/addMember
  // from our helpers module, not the raw shim) ---
  out = out.replace(/createUser\(sqlite,/g, 'await createUser(db,')
  out = out.replace(/createGroup\(sqlite,/g, 'await createGroup(db,')
  out = out.replace(/addMember\(sqlite,/g, 'await addMember(db,')

  // --- Test fn signatures: add async ---
  out = out.replace(
    /(\b(?:it|test)\((?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*)\(\) => \{/g,
    '$1async () => {'
  )
  out = out.replace(
    /(\b(?:it|test)\((?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*)\(([a-zA-Z_][\w]*)\) => \{/g,
    '$1async ($2) => {'
  )

  // --- Local fixture fns → async ---
  const fixtureNames = new Set()
  let fm
  const reFixture = new RegExp(LOCAL_FIXTURE_RE.source, 'g')
  while ((fm = reFixture.exec(out)) !== null) {
    fixtureNames.add(fm[3])
  }
  out = out.replace(LOCAL_FIXTURE_RE, (_m, ws, already, name) =>
    already ? _m : `${ws}async function ${name}(`
  )
  for (const name of fixtureNames) {
    const re = new RegExp(
      String.raw`(?<![\w$])(?<!await )(?<!function )(?<!async function )${name}\(`,
      'g'
    )
    out = out.replace(re, `await ${name}(`)
  }

  // --- Boolean literal fixes ---
  const boolFields = ['isPaid', 'autoRenew', 'inactive', 'notify', 'showEmail']
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

  // --- Auto-await lib/handler calls ---
  for (const fn of ASYNC_FNS) {
    const re = new RegExp(
      String.raw`(?<![\w$])(?<!await )(?<!function )(?<!async function )${fn}\(`,
      'g'
    )
    out = out.replace(re, `await ${fn}(`)
  }
  // Undo accidental await inside import braces (run multiple times)
  for (let i = 0; i < 4; i++) {
    out = out.replace(
      /(import \{[^}]*?)await ([A-Za-z_][\w]*)(\s*[,}])/g,
      '$1$2$3'
    )
  }

  // --- Auto-await sqlite.prepare(...).method() raw SQL sites ---
  // Pattern: `sqlite.prepare(...).get()` (multi-line tolerated)
  out = out.replace(
    /(?<![\w$])(?<!await )sqlite\s*\n?\s*\.prepare\(/g,
    'await sqlite.prepare('
  )
  // Also `sqlite.exec(...)` and `sqlite.pragma(...)`.
  out = out.replace(
    /(?<![\w$])(?<!await )sqlite\.exec\(/g,
    'await sqlite.exec('
  )
  // pragma is now a sync noop in shim — no await needed.

  // --- Double-await collapse ---
  out = out.replace(/\bawait\s+await\b/g, 'await')

  if (out !== orig) {
    writeFileSync(abs, out)
    touched++
  } else {
    skipped.push(file)
  }
}

console.log(`Touched: ${touched} / ${files.length}`)
if (skipped.length) console.log('Skipped:', skipped)

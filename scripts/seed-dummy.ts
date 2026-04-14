/**
 * scripts/seed-dummy.ts
 *
 * Populate the local dev DB with realistic dummy data:
 *   4 users, 6 subscriptions with overlapping membership, friendships,
 *   a few paid + unpaid bills, a handful of notifications.
 *
 * Usage:
 *   npx tsx scripts/seed-dummy.ts            # add to existing DB (skips if users exist)
 *   npx tsx scripts/seed-dummy.ts --reset    # wipe the DB file and start clean
 *
 * All users share the password `password123`. Log in as any of them.
 */

import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { hashSync } from 'bcryptjs'
import { migrate } from '../src/db/migrate'
import * as schema from '../src/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  generateMonthlyBills,
  changeSubscriptionPrice,
} from '../src/lib/db-operations'
import { insertNotification } from '../src/lib/notifications'

const DB_PATH =
  process.env.DATABASE_URL ??
  path.join(process.cwd(), 'data', 'subshare.db')

const args = new Set(process.argv.slice(2))
const RESET = args.has('--reset')

function main() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

  if (RESET) {
    for (const suffix of ['', '-shm', '-wal']) {
      const p = `${DB_PATH}${suffix}`
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
    console.log(`[seed] reset: removed ${DB_PATH}*`)
  }

  const sqlite = new Database(DB_PATH)
  sqlite.pragma('foreign_keys = ON')
  migrate(sqlite)
  const db = drizzle(sqlite, { schema })

  // ── Skip if DB already populated ──────────────────────────────
  const existingCount = sqlite
    .prepare('SELECT COUNT(*) AS n FROM users')
    .get() as { n: number }
  if (existingCount.n > 0 && !RESET) {
    console.log(
      `[seed] users already exist (${existingCount.n} found); skipping. Use --reset to wipe.`
    )
    return
  }

  const passwordHash = hashSync('password123', 10)

  // ── Users ─────────────────────────────────────────────────────
  const alice = insertUser(sqlite, {
    name: 'Alice Chen',
    email: 'alice@test.local',
    passwordHash,
    preferredCurrency: 'CNY',
    displayName: 'Alice',
    showEmail: 1,
  })
  const bob = insertUser(sqlite, {
    name: 'Bob Wang',
    email: 'bob@test.local',
    passwordHash,
    preferredCurrency: 'CNY',
    displayName: 'Bob',
    showEmail: 1,
  })
  const carol = insertUser(sqlite, {
    name: 'Carol Lee',
    email: 'carol@test.local',
    passwordHash,
    preferredCurrency: 'USD', // cross-currency splash
    displayName: 'Carol',
    showEmail: 0,
  })
  const dave = insertUser(sqlite, {
    name: 'Dave Zhang',
    email: 'dave@test.local',
    passwordHash,
    preferredCurrency: 'CNY',
    displayName: 'Dave',
    showEmail: 1,
  })

  console.log(
    `[seed] users: alice=${alice}, bob=${bob}, carol=${carol}, dave=${dave}`
  )

  // ── Subscriptions ─────────────────────────────────────────────
  // Rates for cross-currency members (CNY→USD for Carol).
  const rates = { CNY_USD: 0.14 }

  // 1. Netflix: Alice (payer), Bob, Carol, Dave — 4-person split, CNY
  const netflix = createSubscription(db, {
    name: 'Netflix',
    price: 6000, // ¥60
    currency: 'CNY',
    nextPayment: '2026-05-01',
    startDate: '2026-01-15',
    ownerId: alice,
    logo: 'netflix',
  })
  addMemberToSubscription(
    db,
    { subscriptionId: netflix.id, userId: bob, addedBy: alice, addedAt: '2026-01-15' },
    rates
  )
  addMemberToSubscription(
    db,
    { subscriptionId: netflix.id, userId: carol, addedBy: alice, addedAt: '2026-01-15' },
    rates
  )
  addMemberToSubscription(
    db,
    { subscriptionId: netflix.id, userId: dave, addedBy: alice, addedAt: '2026-03-10' }, // mid-month joiner
    rates
  )

  // 2. Spotify Family: Bob (payer), Alice, Carol — 3-person, CNY
  const spotify = createSubscription(db, {
    name: 'Spotify',
    price: 3000, // ¥30
    currency: 'CNY',
    nextPayment: '2026-05-05',
    startDate: '2026-02-01',
    ownerId: bob,
    logo: 'spotify',
  })
  addMemberToSubscription(
    db,
    { subscriptionId: spotify.id, userId: alice, addedBy: bob, addedAt: '2026-02-01' },
    rates
  )
  addMemberToSubscription(
    db,
    { subscriptionId: spotify.id, userId: carol, addedBy: bob, addedAt: '2026-02-01' },
    rates
  )

  // 3. YouTube Premium: Alice (payer), Dave — 2-person, CNY
  const youtube = createSubscription(db, {
    name: 'YouTube',
    price: 4000, // ¥40
    currency: 'CNY',
    nextPayment: '2026-05-12',
    startDate: '2026-03-01',
    ownerId: alice,
    logo: 'youtube',
  })
  addMemberToSubscription(
    db,
    { subscriptionId: youtube.id, userId: dave, addedBy: alice, addedAt: '2026-03-01' },
    rates
  )

  // 4. iCloud: Carol (payer), Alice, Bob — 3-person, USD (Carol's primary)
  const icloud = createSubscription(db, {
    name: 'iCloud',
    price: 999, // $9.99
    currency: 'USD',
    nextPayment: '2026-05-03',
    startDate: '2026-02-15',
    ownerId: carol,
    logo: 'icloud',
  })
  addMemberToSubscription(
    db,
    {
      subscriptionId: icloud.id,
      userId: alice,
      addedBy: carol,
      addedAt: '2026-02-15',
    },
    { USD_CNY: 7.2 }
  )
  addMemberToSubscription(
    db,
    {
      subscriptionId: icloud.id,
      userId: bob,
      addedBy: carol,
      addedAt: '2026-02-15',
    },
    { USD_CNY: 7.2 }
  )

  // 5. ChatGPT: Dave (payer), Bob — 2-person, CNY
  const chatgpt = createSubscription(db, {
    name: 'ChatGPT',
    price: 14500, // ¥145
    currency: 'CNY',
    nextPayment: '2026-05-20',
    startDate: '2026-03-20',
    ownerId: dave,
    logo: 'openai',
  })
  addMemberToSubscription(
    db,
    { subscriptionId: chatgpt.id, userId: bob, addedBy: dave, addedAt: '2026-03-20' },
    rates
  )

  // 6. Disney+: Alice personal sub (no members besides owner)
  createSubscription(db, {
    name: 'Disney+',
    price: 2500,
    currency: 'CNY',
    nextPayment: '2026-05-08',
    startDate: '2026-02-08',
    ownerId: alice,
    logo: 'disneyplus',
  })

  console.log('[seed] 6 subscriptions created')

  // ── April R1 bills (monthly cron for a past month) ────────────
  // Generates share bills for every non-payer member as of 2026-04-01.
  const aprilBills = generateMonthlyBills(db, '2026-04', {
    CNY_USD: 0.14,
    USD_CNY: 7.2,
  })
  console.log(`[seed] R1 monthly bills for April: ${aprilBills} inserted`)

  // Mark some April bills as paid to seed Settlement/Paid history.
  // Alice↔Bob for Netflix, and Carol↔Alice for iCloud: paid.
  sqlite
    .prepare(
      `UPDATE billing_records
       SET is_paid = 1, paid_at = '2026-04-05T09:00:00Z'
       WHERE subscription_id = ? AND user_id = ?`
    )
    .run(netflix.id, bob)
  sqlite
    .prepare(
      `UPDATE billing_records
       SET is_paid = 1, paid_at = '2026-04-07T10:30:00Z'
       WHERE subscription_id = ? AND user_id = ?`
    )
    .run(icloud.id, alice)

  // ── A retroactive price change for notifications splash ───────
  // Bob edits Spotify price from ¥30 to ¥35 — triggers R5 NEW + price_changed notifs.
  changeSubscriptionPrice(db, { subscriptionId: spotify.id, newPrice: 3500 })

  // ── Hand-crafted notifications for variety ────────────────────
  insertNotification(db, {
    userId: dave,
    type: 'added_to_sub',
    subscriptionId: chatgpt.id,
    payload: {
      sub_name: 'ChatGPT',
      actor_name: 'Dave',
      share: 7250,
      share_currency: 'CNY',
      this_cycle_prorated: 3500,
      next_billing_date: '2026-05-20',
    },
  })
  insertNotification(db, {
    userId: bob,
    type: 'payer_changed',
    subscriptionId: youtube.id,
    payload: {
      sub_name: 'YouTube',
      old_payer_name: 'Alice',
      new_payer_name: 'Alice',
      currency: 'CNY',
    },
  })

  console.log('[seed] notifications: price_changed (x2 via R5) + handcrafted')

  console.log(
    '\n[seed] Done. Log in at http://localhost:3000/login with any of:'
  )
  console.log(
    '        alice@test.local | bob@test.local | carol@test.local | dave@test.local'
  )
  console.log('        password: password123')
}

function insertUser(
  sqlite: Database.Database,
  u: {
    name: string
    email: string
    passwordHash: string
    preferredCurrency: string
    displayName: string
    showEmail: number
  }
): number {
  const result = sqlite
    .prepare(
      `INSERT INTO users (name, email, password_hash, preferred_currency, display_name, show_email)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      u.name,
      u.email,
      u.passwordHash,
      u.preferredCurrency,
      u.displayName,
      u.showEmail
    )
  return Number(result.lastInsertRowid)
}

main()

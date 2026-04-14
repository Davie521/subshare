/**
 * scripts/seed-dummy.ts
 *
 * Populate the local dev DB with realistic dummy data:
 *   4 users, 6 subscriptions with overlapping membership, friendships,
 *   a few paid + unpaid bills, a handful of notifications.
 *
 * Usage:
 *   npx tsx scripts/seed-dummy.ts            # add to existing DB (skips if users exist)
 *   npx tsx scripts/seed-dummy.ts --reset    # wipe every table and start clean
 *
 * Requires DATABASE_URL pointing at a Postgres instance (same one the app
 * uses — `postgres://subshare:subshare@localhost:5432/subshare` under
 * docker-compose). All users share the password `password123`.
 */

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
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

const args = new Set(process.argv.slice(2))
const RESET = args.has('--reset')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      '[seed] DATABASE_URL is not set. Set it to your Postgres connection string, e.g.\n' +
        '       postgres://subshare:subshare@localhost:5432/subshare'
    )
    process.exit(1)
  }

  const client = postgres(url, { max: 5 })
  const db = drizzle(client, { schema })

  try {
    await migrate(db)

    if (RESET) {
      // Wipe in FK-safe order. TRUNCATE … CASCADE handles the rest.
      await client`TRUNCATE
        notifications,
        billing_records,
        circle_members,
        circles,
        subscription_members,
        friendships,
        subscriptions,
        users
        RESTART IDENTITY CASCADE`
      console.log('[seed] reset: truncated every table')
    }

    // Skip if DB already populated
    const [{ n }] = (await client`SELECT COUNT(*)::int AS n FROM users`) as [
      { n: number },
    ]
    if (n > 0 && !RESET) {
      console.log(
        `[seed] users already exist (${n} found); skipping. Use --reset to wipe.`
      )
      return
    }

    const passwordHash = hashSync('password123', 10)

    // ── Users ─────────────────────────────────────────────────────
    const alice = await insertUser(client, {
      name: 'Alice Chen',
      email: 'alice@test.local',
      passwordHash,
      preferredCurrency: 'CNY',
      displayName: 'Alice',
      showEmail: true,
    })
    const bob = await insertUser(client, {
      name: 'Bob Wang',
      email: 'bob@test.local',
      passwordHash,
      preferredCurrency: 'CNY',
      displayName: 'Bob',
      showEmail: true,
    })
    const carol = await insertUser(client, {
      name: 'Carol Lee',
      email: 'carol@test.local',
      passwordHash,
      preferredCurrency: 'USD', // cross-currency splash
      displayName: 'Carol',
      showEmail: false,
    })
    const dave = await insertUser(client, {
      name: 'Dave Zhang',
      email: 'dave@test.local',
      passwordHash,
      preferredCurrency: 'CNY',
      displayName: 'Dave',
      showEmail: true,
    })

    console.log(
      `[seed] users: alice=${alice}, bob=${bob}, carol=${carol}, dave=${dave}`
    )

    // ── Subscriptions ─────────────────────────────────────────────
    const rates = { CNY_USD: 0.14 }

    // 1. Netflix: Alice (payer), Bob, Carol, Dave — 4-person split, CNY
    const netflix = await createSubscription(db, {
      name: 'Netflix',
      price: 6000,
      currency: 'CNY',
      nextPayment: '2026-05-01',
      startDate: '2026-01-15',
      ownerId: alice,
      logo: 'netflix',
    })
    await addMemberToSubscription(
      db,
      { subscriptionId: netflix.id, userId: bob, addedBy: alice, addedAt: '2026-01-15' },
      rates
    )
    await addMemberToSubscription(
      db,
      { subscriptionId: netflix.id, userId: carol, addedBy: alice, addedAt: '2026-01-15' },
      rates
    )
    await addMemberToSubscription(
      db,
      { subscriptionId: netflix.id, userId: dave, addedBy: alice, addedAt: '2026-03-10' },
      rates
    )

    // 2. Spotify Family: Bob (payer), Alice, Carol — 3-person, CNY
    const spotify = await createSubscription(db, {
      name: 'Spotify',
      price: 3000,
      currency: 'CNY',
      nextPayment: '2026-05-05',
      startDate: '2026-02-01',
      ownerId: bob,
      logo: 'spotify',
    })
    await addMemberToSubscription(
      db,
      { subscriptionId: spotify.id, userId: alice, addedBy: bob, addedAt: '2026-02-01' },
      rates
    )
    await addMemberToSubscription(
      db,
      { subscriptionId: spotify.id, userId: carol, addedBy: bob, addedAt: '2026-02-01' },
      rates
    )

    // 3. YouTube Premium: Alice (payer), Dave — 2-person, CNY
    const youtube = await createSubscription(db, {
      name: 'YouTube',
      price: 4000,
      currency: 'CNY',
      nextPayment: '2026-05-12',
      startDate: '2026-03-01',
      ownerId: alice,
      logo: 'youtube',
    })
    await addMemberToSubscription(
      db,
      { subscriptionId: youtube.id, userId: dave, addedBy: alice, addedAt: '2026-03-01' },
      rates
    )

    // 4. iCloud: Carol (payer), Alice, Bob — 3-person, USD (Carol's primary)
    const icloud = await createSubscription(db, {
      name: 'iCloud',
      price: 999,
      currency: 'USD',
      nextPayment: '2026-05-03',
      startDate: '2026-02-15',
      ownerId: carol,
      logo: 'icloud',
    })
    await addMemberToSubscription(
      db,
      {
        subscriptionId: icloud.id,
        userId: alice,
        addedBy: carol,
        addedAt: '2026-02-15',
      },
      { USD_CNY: 7.2 }
    )
    await addMemberToSubscription(
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
    const chatgpt = await createSubscription(db, {
      name: 'ChatGPT',
      price: 14500,
      currency: 'CNY',
      nextPayment: '2026-05-20',
      startDate: '2026-03-20',
      ownerId: dave,
      logo: 'openai',
    })
    await addMemberToSubscription(
      db,
      { subscriptionId: chatgpt.id, userId: bob, addedBy: dave, addedAt: '2026-03-20' },
      rates
    )

    // 6. Disney+: Alice personal sub (no members besides owner)
    await createSubscription(db, {
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
    const aprilBills = await generateMonthlyBills(db, '2026-04', {
      CNY_USD: 0.14,
      USD_CNY: 7.2,
    })
    console.log(`[seed] R1 monthly bills for April: ${aprilBills} inserted`)

    // Mark some April bills as paid.
    await client`
      UPDATE billing_records
      SET is_paid = true, paid_at = '2026-04-05T09:00:00Z'
      WHERE subscription_id = ${netflix.id} AND user_id = ${bob}
    `
    await client`
      UPDATE billing_records
      SET is_paid = true, paid_at = '2026-04-07T10:30:00Z'
      WHERE subscription_id = ${icloud.id} AND user_id = ${alice}
    `

    // ── R5 price change — triggers price_changed notifications ────
    await changeSubscriptionPrice(db, {
      subscriptionId: spotify.id,
      newPrice: 3500,
    })

    // ── Hand-crafted notifications ────────────────────────────────
    await insertNotification(db, {
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
    await insertNotification(db, {
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
  } finally {
    await client.end()
  }
}

async function insertUser(
  client: postgres.Sql,
  u: {
    name: string
    email: string
    passwordHash: string
    preferredCurrency: string
    displayName: string
    showEmail: boolean
  }
): Promise<number> {
  const [{ id }] = (await client`
    INSERT INTO users (
      name, email, password_hash, preferred_currency, display_name, show_email
    )
    VALUES (
      ${u.name}, ${u.email}, ${u.passwordHash},
      ${u.preferredCurrency}, ${u.displayName}, ${u.showEmail}
    )
    RETURNING id
  `) as [{ id: number }]
  return id
}

main().catch((err) => {
  console.error('[seed] failed:', err)
  process.exit(1)
})

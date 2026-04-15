/**
 * scripts/seed-dummy.ts
 *
 * Populate the local dev DB with a richly populated social graph centered
 * on Alice — different group of co-subscribers per sub (couple, family,
 * coworker, college friends, gaming buddies, study group, mom's family
 * book club), four months of clean R1 billing history, a payer transfer,
 * a member who left, and a cancelled subscription. Designed so every UI
 * screen has interesting content.
 *
 * Why we wipe billing_records before generating monthly bills:
 *   addMemberToSubscription() unconditionally writes an R2 join-prorate
 *   bill at the canonical addedAt date. When several members are added
 *   on the same day-1 of a month, those R2 bills cascade with stale
 *   share counts ($price/2, then $price/3, then $price/4 …) instead of
 *   the final month-end share. We wipe and regenerate via the R1 cron so
 *   every month-1 bill reflects the actual final headcount.
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
import { hash } from 'bcryptjs'
import { migrate } from '../src/db/migrate'
import * as schema from '../src/db/schema'
import {
  createSubscription,
  addMemberToSubscription,
  generateMonthlyBills,
  changeSubscriptionPrice,
  transferPayer,
  leaveSubscription,
} from '../src/lib/db-operations'
import { insertNotification } from '../src/lib/notifications'

const args = new Set(process.argv.slice(2))
const RESET = args.has('--reset')
const FORCE = args.has('--force')

// FX rates for April 2026 — covers every (subCurrency, userCurrency)
// pair that could arise. Format: `${from}_${to}` → multiplier.
const RATES: Record<string, number> = {
  // from CNY
  CNY_USD: 0.139,
  CNY_GBP: 0.111,
  CNY_JPY: 20.83,
  CNY_HKD: 1.087,
  CNY_CAD: 0.19,
  // from USD
  USD_CNY: 7.2,
  USD_GBP: 0.8,
  USD_JPY: 150,
  USD_HKD: 7.78,
  USD_CAD: 1.37,
  // from HKD
  HKD_CNY: 0.92,
  HKD_USD: 0.128,
  HKD_GBP: 0.103,
  HKD_JPY: 19.28,
  HKD_CAD: 0.176,
  // from CAD
  CAD_CNY: 5.26,
  CAD_USD: 0.73,
  CAD_GBP: 0.584,
  CAD_JPY: 109.5,
  CAD_HKD: 5.68,
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !FORCE) {
    console.error(
      '[seed] refusing to run in NODE_ENV=production. Pass --force if you really mean it.'
    )
    process.exit(1)
  }

  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      '[seed] DATABASE_URL is not set. Set it to your Postgres connection string, e.g.\n' +
        '       postgres://subshare:subshare@localhost:5432/subshare'
    )
    process.exit(1)
  }

  if (RESET && !FORCE) {
    const marker = url.includes('localhost') || url.includes('127.0.0.1')
    if (!marker) {
      console.error(
        '[seed] --reset on a non-localhost DATABASE_URL requires --force to confirm.'
      )
      process.exit(1)
    }
  }

  const ssl = process.env.PGSSLMODE === 'disable' ? false : 'prefer'
  const client = postgres(url, { max: 5, ssl })
  const db = drizzle(client, { schema })

  try {
    await migrate(db)

    if (RESET) {
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

    const [{ n }] = (await client`SELECT COUNT(*)::int AS n FROM users`) as [
      { n: number },
    ]
    if (n > 0 && !RESET) {
      console.log(
        `[seed] users already exist (${n} found); skipping. Use --reset to wipe.`
      )
      return
    }

    const passwordHash = await hash('password123', 10)

    // ── Users ─────────────────────────────────────────────────────
    const alice = await insertUser(client, {
      name: 'Alice Chen', email: 'alice@test.local', passwordHash,
      preferredCurrency: 'CNY', displayName: 'Alice', showEmail: true,
    })
    const bob = await insertUser(client, {
      name: 'Bob Wang', email: 'bob@test.local', passwordHash,
      preferredCurrency: 'CNY', displayName: '小王', showEmail: true,
    })
    const carol = await insertUser(client, {
      name: 'Carol Lee', email: 'carol@test.local', passwordHash,
      preferredCurrency: 'USD', displayName: 'Carol', showEmail: false,
    })
    const dave = await insertUser(client, {
      name: 'Dave Zhang', email: 'dave@test.local', passwordHash,
      preferredCurrency: 'CNY', displayName: '老张', showEmail: false,
    })
    const emma = await insertUser(client, {
      name: 'Emma Liu', email: 'emma@test.local', passwordHash,
      preferredCurrency: 'GBP', displayName: 'Emma', showEmail: true,
    })
    const frank = await insertUser(client, {
      name: 'Frank Wu', email: 'frank@test.local', passwordHash,
      preferredCurrency: 'JPY', displayName: 'Frank-san', showEmail: false,
    })
    const grace = await insertUser(client, {
      name: 'Grace Sun', email: 'grace@test.local', passwordHash,
      preferredCurrency: 'HKD', displayName: 'Grace姐', showEmail: true,
    })
    const henry = await insertUser(client, {
      name: 'Henry Chen', email: 'henry@test.local', passwordHash,
      preferredCurrency: 'CNY', displayName: 'Henry', showEmail: true,
    })
    const jack = await insertUser(client, {
      name: 'Jack Smith', email: 'jack@test.local', passwordHash,
      preferredCurrency: 'CAD', displayName: 'Jack', showEmail: false,
    })
    const kate = await insertUser(client, {
      name: 'Kate Chen', email: 'kate@test.local', passwordHash,
      preferredCurrency: 'CNY', displayName: '陈妈', showEmail: true,
    })

    console.log(
      `[seed] users: alice=${alice}, bob=${bob}, carol=${carol}, ` +
        `dave=${dave}, emma=${emma}, frank=${frank}, grace=${grace}, ` +
        `henry=${henry}, jack=${jack}, kate=${kate}`
    )

    // ── Subscriptions + initial members ───────────────────────────
    // All initial members join on the 1st of the start month so that
    // the wipe-and-regenerate step below produces uniform R1 amounts.

    // 1) Netflix Premium — partner + siblings (Jan-start family group).
    const netflix = await createSubscription(db, {
      name: 'Netflix', price: 12000, currency: 'CNY',
      nextPayment: '2026-05-01', startDate: '2026-01-01',
      ownerId: alice, logo: 'netflix',
    })
    await addMemberToSubscription(db,
      { subscriptionId: netflix.id, userId: bob, addedBy: alice, addedAt: '2026-01-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: netflix.id, userId: henry, addedBy: alice, addedAt: '2026-01-01' }, RATES)

    // 2) ChatGPT Plus — Alice + manager (Feb-start coworker tools).
    const chatgpt = await createSubscription(db, {
      name: 'ChatGPT', price: 14500, currency: 'CNY',
      nextPayment: '2026-05-01', startDate: '2026-02-01',
      ownerId: alice, logo: 'openai',
    })
    await addMemberToSubscription(db,
      { subscriptionId: chatgpt.id, userId: dave, addedBy: alice, addedAt: '2026-02-01' }, RATES)

    // 3) iCloud+ 2TB — partner + brother (Jan-start sibling storage).
    const icloud = await createSubscription(db, {
      name: 'iCloud', price: 4500, currency: 'CNY',
      nextPayment: '2026-05-01', startDate: '2026-01-01',
      ownerId: alice, logo: 'icloud',
    })
    await addMemberToSubscription(db,
      { subscriptionId: icloud.id, userId: bob, addedBy: alice, addedAt: '2026-01-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: icloud.id, userId: henry, addedBy: alice, addedAt: '2026-01-01' }, RATES)

    // 4) Notion Plus — partner workspace (Feb-start).
    const notion = await createSubscription(db, {
      name: 'Notion', price: 8000, currency: 'CNY',
      nextPayment: '2026-05-01', startDate: '2026-02-01',
      ownerId: alice, logo: 'notion',
    })
    await addMemberToSubscription(db,
      { subscriptionId: notion.id, userId: bob, addedBy: alice, addedAt: '2026-02-01' }, RATES)

    // 5) Disney+ — Alice's solo guilty pleasure.
    await createSubscription(db, {
      name: 'Disney+', price: 3500, currency: 'CNY',
      nextPayment: '2026-05-01', startDate: '2026-02-01',
      ownerId: alice, logo: 'disneyplus',
    })

    // 6) Spotify Duo — partner pays, just the couple.
    const spotify = await createSubscription(db, {
      name: 'Spotify', price: 3000, currency: 'CNY',
      nextPayment: '2026-05-01', startDate: '2026-01-01',
      ownerId: bob, logo: 'spotify',
    })
    await addMemberToSubscription(db,
      { subscriptionId: spotify.id, userId: alice, addedBy: bob, addedAt: '2026-01-01' }, RATES)

    // 7) Apple One Family — Carol pays USD; college friends scattered
    // across SF / Tokyo / Toronto. Multi-currency settlement demo.
    const appleOne = await createSubscription(db, {
      name: 'Apple One', price: 2595, currency: 'USD',
      nextPayment: '2026-05-01', startDate: '2026-01-01',
      ownerId: carol, logo: 'apple',
    })
    await addMemberToSubscription(db,
      { subscriptionId: appleOne.id, userId: alice, addedBy: carol, addedAt: '2026-01-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: appleOne.id, userId: frank, addedBy: carol, addedAt: '2026-01-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: appleOne.id, userId: jack, addedBy: carol, addedAt: '2026-01-01' }, RATES)

    // 8) YouTube Premium Family — Grace pays HKD; extended family
    // across mainland / HK / UK.
    const youtube = await createSubscription(db, {
      name: 'YouTube', price: 8900, currency: 'HKD',
      nextPayment: '2026-05-01', startDate: '2026-02-01',
      ownerId: grace, logo: 'youtube',
    })
    await addMemberToSubscription(db,
      { subscriptionId: youtube.id, userId: alice, addedBy: grace, addedAt: '2026-02-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: youtube.id, userId: bob, addedBy: grace, addedAt: '2026-02-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: youtube.id, userId: emma, addedBy: grace, addedAt: '2026-02-01' }, RATES)

    // 9) NYTimes — manager pays USD; news habit (Feb-start).
    const nytimes = await createSubscription(db, {
      name: 'NYTimes', price: 1700, currency: 'USD',
      nextPayment: '2026-05-01', startDate: '2026-02-01',
      ownerId: dave, logo: 'nytimes',
    })
    await addMemberToSubscription(db,
      { subscriptionId: nytimes.id, userId: alice, addedBy: dave, addedAt: '2026-02-01' }, RATES)

    // 10) Audible — Mom pays for the family book club.
    const audible = await createSubscription(db, {
      name: 'Audible', price: 7800, currency: 'CNY',
      nextPayment: '2026-05-01', startDate: '2026-01-01',
      ownerId: kate, logo: 'audible',
    })
    await addMemberToSubscription(db,
      { subscriptionId: audible.id, userId: alice, addedBy: kate, addedAt: '2026-01-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: audible.id, userId: emma, addedBy: kate, addedAt: '2026-01-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: audible.id, userId: henry, addedBy: kate, addedAt: '2026-01-01' }, RATES)

    // 11) Coursera Plus — study group; Henry will leave Apr 1 (R3).
    const coursera = await createSubscription(db, {
      name: 'Coursera', price: 7900, currency: 'CAD',
      nextPayment: '2026-05-01', startDate: '2026-01-01',
      ownerId: jack, logo: 'coursera',
    })
    await addMemberToSubscription(db,
      { subscriptionId: coursera.id, userId: alice, addedBy: jack, addedAt: '2026-01-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: coursera.id, userId: henry, addedBy: jack, addedAt: '2026-01-01' }, RATES)

    // 12) PlayStation Plus — gaming friends; payer transfers Frank → Bob (R7).
    const psplus = await createSubscription(db, {
      name: 'PlayStation Plus', price: 1800, currency: 'CNY',
      nextPayment: '2026-05-01', startDate: '2026-01-01',
      ownerId: frank, logo: 'playstation',
    })
    await addMemberToSubscription(db,
      { subscriptionId: psplus.id, userId: alice, addedBy: frank, addedAt: '2026-01-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: psplus.id, userId: bob, addedBy: frank, addedAt: '2026-01-01' }, RATES)
    await addMemberToSubscription(db,
      { subscriptionId: psplus.id, userId: henry, addedBy: frank, addedAt: '2026-01-01' }, RATES)

    // 13) Adobe Creative Cloud — Alice paid, recently cancelled.
    const adobe = await createSubscription(db, {
      name: 'Adobe', price: 22800, currency: 'CNY',
      nextPayment: '2026-04-01', startDate: '2026-01-01',
      ownerId: alice, logo: 'adobe',
    })
    await addMemberToSubscription(db,
      { subscriptionId: adobe.id, userId: bob, addedBy: alice, addedAt: '2026-01-01' }, RATES)

    console.log('[seed] 13 subscriptions created with initial memberships')

    // ── Wipe cascade R2 bills, then generate clean R1 history ─────
    // See header comment for rationale.
    await client`DELETE FROM billing_records`
    // Also clear the auto-emitted added_to_sub notifications from the
    // cascade — we'll re-emit cleaner ones below.
    await client`DELETE FROM notifications`

    const janBills = await generateMonthlyBills(db, '2026-01', RATES)
    const febBills = await generateMonthlyBills(db, '2026-02', RATES)
    const marBills = await generateMonthlyBills(db, '2026-03', RATES)

    // ── R2 demo: Emma joins Netflix mid-March (sister got UK flat) ─
    await addMemberToSubscription(db,
      { subscriptionId: netflix.id, userId: emma, addedBy: alice, addedAt: '2026-03-10' }, RATES)

    // ── Lifecycle events between Mar and Apr ──────────────────────

    // R7 — transfer PlayStation Plus payer from Frank to Bob.
    await transferPayer(db, { subscriptionId: psplus.id, newPayerId: bob })

    // R3 — Jack (payer) kicks Henry from Coursera Apr 1 after Henry stopped
    // paying his share. Kick path emits a `removed_from_sub` notification to
    // Henry; self-leave would not.
    await leaveSubscription(db, {
      subscriptionId: coursera.id, userId: henry, leftAt: '2026-04-01',
      actorId: jack,
    })

    // Cancel Adobe Mar 31 — flip inactive flag so April R1 skips it.
    await client`
      UPDATE subscriptions
      SET inactive = true
      WHERE id = ${adobe.id}
    `

    // ── April R1 with the new state ───────────────────────────────
    const aprBills = await generateMonthlyBills(db, '2026-04', RATES)
    console.log(
      `[seed] R1 monthly bills: Jan=${janBills}, Feb=${febBills}, ` +
        `Mar=${marBills}, Apr=${aprBills}`
    )

    // ── R5 price changes (rewrites Apr unpaid bills, fires notifications) ──
    await changeSubscriptionPrice(db, {
      subscriptionId: coursera.id, newPrice: 8900, // C$79 → C$89
    })
    await changeSubscriptionPrice(db, {
      subscriptionId: spotify.id, newPrice: 3500, // ¥30 → ¥35
    })

    // ── Mark a curated set of bills paid for settlement history ───
    // Jan: fully paid (clean prior month).
    // Feb: fully paid.
    // Mar: ~half paid.
    // Apr: only a couple paid early.
    await client`
      UPDATE billing_records SET is_paid = true, paid_at = '2026-02-04T10:00:00Z'
      WHERE billing_date = '2026-01-01'
    `
    await client`
      UPDATE billing_records SET is_paid = true, paid_at = '2026-03-04T10:00:00Z'
      WHERE billing_date = '2026-02-01'
    `
    await client`
      UPDATE billing_records SET is_paid = true, paid_at = '2026-04-02T11:00:00Z'
      WHERE billing_date = '2026-03-01'
        AND subscription_id IN (${netflix.id}, ${spotify.id}, ${appleOne.id}, ${audible.id})
    `
    await client`
      UPDATE billing_records SET is_paid = true, paid_at = '2026-04-05T09:00:00Z'
      WHERE billing_date = '2026-04-01'
        AND subscription_id = ${spotify.id} AND user_id = ${alice}
    `
    await client`
      UPDATE billing_records SET is_paid = true, paid_at = '2026-04-07T10:30:00Z'
      WHERE billing_date = '2026-04-01'
        AND subscription_id = ${appleOne.id} AND user_id = ${alice}
    `

    // ── Hand-crafted notifications + mark older as read ───────────
    await insertNotification(db, {
      userId: alice, type: 'added_to_sub', subscriptionId: nytimes.id,
      payload: {
        sub_name: 'NYTimes', actor_name: '老张',
        share: 850, share_currency: 'USD', next_billing_date: '2026-05-01',
      },
    })

    // Mark notifications older than ~3 days as read so the unread badge
    // surfaces only the recent R5 / R7 / R3 events.
    await client`
      UPDATE notifications SET read_at = '2026-04-12T08:00:00Z'
      WHERE created_at < '2026-04-10T00:00:00Z'
    `

    console.log('[seed] notifications: all 4 types covered, mixed read/unread')

    console.log('\n[seed] Done. Log in at http://localhost:3000/login with any of:')
    console.log(
      '        alice / bob / carol / dave / emma / frank / grace / henry / jack / kate @test.local'
    )
    console.log('        password: password123')
    console.log('        (alice@test.local has the most populated dashboard)')
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

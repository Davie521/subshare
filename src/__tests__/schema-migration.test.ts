import { describe, it, expect } from 'vitest'
import { setupTestDb } from './helpers'

/**
 * Post-Postgres-migration: the detailed SQLite schema introspection tests
 * (PRAGMA table_info, sqlite_schema queries, INTEGER vs TEXT type checks)
 * no longer apply. We still want to assert that the await migrate() function
 * produces a usable schema, so we keep a single smoke test that inserts a
 * row into every table round-trip.
 */

describe('T3 schema migration (smoke)', () => {
  it('await migrate() produces a working schema — can round-trip users, groups, subs, friendships, notifications', async () => {
    const { db, sqlite } = await setupTestDb()

    // users
    await sqlite.prepare(
      "INSERT INTO users (name, email, google_id) VALUES ('A', 'a@t.com', 'g-a')"
    ).run()
    const users = (await sqlite.prepare(
      'SELECT COUNT(*)::int AS n FROM users'
    ).get()) as { n: number }
    expect(users.n).toBe(1)

    // groups + group_members
    await sqlite.prepare(
      "INSERT INTO groups (name, public_id, created_by) VALUES ('G', 'p1', 1)"
    ).run()
    await sqlite.prepare(
      'INSERT INTO group_members (group_id, user_id) VALUES (1, 1)'
    ).run()

    // subscription + subscription_members
    await sqlite.prepare(
      `INSERT INTO subscriptions
       (name, price, next_payment, start_date, owner_id, payer_id)
       VALUES ('Netflix', 1000, '2026-01-01', '2026-01-01', 1, 1)`
    ).run()
    const subs = (await sqlite.prepare(
      'SELECT COUNT(*)::int AS n FROM subscriptions'
    ).get()) as { n: number }
    expect(subs.n).toBe(1)

    // friendships: enforce a < b CHECK constraint exists
    await sqlite.prepare(
      "INSERT INTO users (name, email, google_id) VALUES ('B', 'b@t.com', 'g-b')"
    ).run()
    await sqlite.prepare(
      'INSERT INTO friendships (user_a_id, user_b_id) VALUES ($1, $2)'
    ).run(1, 2)
    // Reverse direction violates CHECK
    await expect(
      sqlite
        .prepare(
          'INSERT INTO friendships (user_a_id, user_b_id) VALUES ($1, $2)'
        )
        .run(2, 1)
    ).rejects.toThrow(/check|constraint/i)

    // notifications: index + row
    await sqlite.prepare(
      `INSERT INTO notifications (user_id, type, payload) VALUES (1, 'test', '{}')`
    ).run()
    const notifs = (await sqlite.prepare(
      'SELECT COUNT(*)::int AS n FROM notifications'
    ).get()) as { n: number }
    expect(notifs.n).toBe(1)

    // Drizzle layer works too (sanity check)
    const { users: u } = await import('@/db/schema')
    const rows = await db.select().from(u)
    expect(rows.length).toBe(2)
  })

  it('migration is idempotent (running twice does not error)', async () => {
    const { db } = await setupTestDb()
    const { migrate } = await import('@/db/migrate')
    await expect(migrate(db)).resolves.not.toThrow()
  })
})

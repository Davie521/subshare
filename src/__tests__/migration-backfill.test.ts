import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '@/db/migrate'
import { backfillFromGroups } from '@/db/migrate'

/**
 * T15 — backfill legacy (groups, group_members) data into the new
 * subscription-centric tables.
 *
 * Rules:
 *  - For each subscription with a group_id, populate subscription_members
 *    from group_members (addedAt=joined_at, addedBy=group.created_by).
 *  - For each (member != group.created_by), create friendship with creator.
 *  - subscriptions.payer_id is already set by the schema migration
 *    (groups.created_by fallback is in migrate.ts).
 *  - Backfill is idempotent.
 *  - Personal subs (no group_id) already have owner in subscription_members
 *    (from createSubscription auto-insert path) — but legacy DBs may have
 *    subs created before that logic existed, so we also insert owner as
 *    their own subscription_members row for personal subs.
 */

function legacyDb(): Database.Database {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(sqlite)

  // Seed a legacy dataset: 2 users, 1 group, 1 shared sub, 1 personal sub.
  sqlite
    .prepare(
      "INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Alice', 'a@t.com', 'x')"
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO users (id, name, email, password_hash) VALUES (2, 'Bob', 'b@t.com', 'x')"
    )
    .run()

  sqlite
    .prepare(
      "INSERT INTO groups (id, name, public_id, created_by) VALUES (1, 'Fam', 'p1', 1)"
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO group_members (group_id, user_id, joined_at) VALUES (1, 1, '2026-01-01')"
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO group_members (group_id, user_id, joined_at) VALUES (1, 2, '2026-02-15')"
    )
    .run()

  // Shared sub in group 1, payer_id will be filled by migrate() from created_by
  sqlite
    .prepare(
      `INSERT INTO subscriptions
       (id, name, price, currency, next_payment, start_date, owner_id, payer_id, group_id)
       VALUES (10, 'Netflix', 10800, 'CNY', '2026-05-01', '2026-01-01', 1, 1, 1)`
    )
    .run()

  // Personal sub (no group)
  sqlite
    .prepare(
      `INSERT INTO subscriptions
       (id, name, price, currency, next_payment, start_date, owner_id, payer_id)
       VALUES (11, 'Spotify', 1500, 'CNY', '2026-05-01', '2026-01-01', 2, 2)`
    )
    .run()

  return sqlite
}

describe('T15 backfillFromGroups', () => {
  it('populates subscription_members from group_members for shared subs', () => {
    const sqlite = legacyDb()
    const inserted = backfillFromGroups(sqlite)

    const rows = sqlite
      .prepare(
        `SELECT subscription_id, user_id, added_at, added_by, left_at
         FROM subscription_members WHERE subscription_id = 10
         ORDER BY user_id`
      )
      .all() as Array<{
      subscription_id: number
      user_id: number
      added_at: string
      added_by: number
      left_at: string | null
    }>

    expect(inserted).toBeGreaterThan(0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      subscription_id: 10,
      user_id: 1,
      added_at: '2026-01-01',
      added_by: 1,
      left_at: null,
    })
    expect(rows[1]).toMatchObject({
      subscription_id: 10,
      user_id: 2,
      added_at: '2026-02-15',
      added_by: 1,
    })
  })

  it('populates subscription_members for personal subs (owner as sole member)', () => {
    const sqlite = legacyDb()
    backfillFromGroups(sqlite)

    const rows = sqlite
      .prepare(
        `SELECT user_id FROM subscription_members WHERE subscription_id = 11`
      )
      .all() as { user_id: number }[]
    expect(rows.map((r) => r.user_id)).toEqual([2])
  })

  it('creates friendships between group creator and each other member', () => {
    const sqlite = legacyDb()
    backfillFromGroups(sqlite)

    const rows = sqlite
      .prepare(
        `SELECT user_a_id, user_b_id FROM friendships`
      )
      .all() as { user_a_id: number; user_b_id: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].user_a_id).toBe(1)
    expect(rows[0].user_b_id).toBe(2)
  })

  it('does NOT create friendship for self (creator is their own group member)', () => {
    const sqlite = legacyDb()
    backfillFromGroups(sqlite)

    const selfRows = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM friendships WHERE user_a_id = user_b_id`
      )
      .get() as { n: number }
    expect(selfRows.n).toBe(0)
  })

  it('is idempotent — running twice does not duplicate', () => {
    const sqlite = legacyDb()
    backfillFromGroups(sqlite)
    backfillFromGroups(sqlite)

    const subMembers = sqlite
      .prepare('SELECT COUNT(*) AS n FROM subscription_members')
      .get() as { n: number }
    const friendships = sqlite
      .prepare('SELECT COUNT(*) AS n FROM friendships')
      .get() as { n: number }

    expect(subMembers.n).toBe(3) // 2 shared + 1 personal owner
    expect(friendships.n).toBe(1)
  })

  it('no-op on already-migrated data (subscription_members already populated)', () => {
    const sqlite = legacyDb()

    // Pre-populate subscription_members from somewhere else.
    sqlite
      .prepare(
        `INSERT INTO subscription_members (subscription_id, user_id, added_at, added_by)
         VALUES (10, 1, '2020-01-01', 1)`
      )
      .run()

    backfillFromGroups(sqlite)

    // User 1's row was already there from pre-population: original added_at preserved.
    const row = sqlite
      .prepare(
        `SELECT added_at FROM subscription_members WHERE subscription_id = 10 AND user_id = 1`
      )
      .get() as { added_at: string }
    expect(row.added_at).toBe('2020-01-01')
  })
})

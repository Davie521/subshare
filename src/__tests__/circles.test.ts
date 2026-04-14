import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { setupTestDb, createUser } from './helpers'
import * as schema from '@/db/schema'
import {
  createCircle,
  listCirclesForOwner,
  getCircle,
  updateCircle,
  deleteCircle,
} from '@/lib/circles'

/**
 * T32 — Circles (UI "Group" templates).
 *
 * Snapshot-only member-preset storage. No FK from subscriptions.
 * Selecting a circle at sub creation copies members; editing the
 * circle afterwards never propagates.
 */

let db: BetterSQLite3Database<typeof schema>
let sqlite: Database.Database

beforeEach(() => {
  const setup = setupTestDb()
  db = setup.db
  sqlite = setup.sqlite
})

describe('T32 Circles CRUD', () => {
  it('creates a circle with owner auto-added as member', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const c = createUser(sqlite, { email: 'c@t.com' })

    const { id } = createCircle(db, {
      ownerUserId: a,
      name: 'Family',
      memberIds: [b, c],
    })

    const circle = getCircle(db, id, a)
    expect(circle).not.toBeNull()
    expect(circle!.name).toBe('Family')
    expect(circle!.memberIds.sort()).toEqual([a, b, c].sort())
  })

  it('rejects empty name', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    expect(() =>
      createCircle(db, { ownerUserId: a, name: '   ' })
    ).toThrow(/empty/i)
  })

  it('stores optional defaultPayerId', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })

    const { id } = createCircle(db, {
      ownerUserId: a,
      name: 'Roommates',
      memberIds: [b],
      defaultPayerId: b,
    })

    const circle = getCircle(db, id, a)
    expect(circle!.defaultPayerId).toBe(b)
  })

  it('listCirclesForOwner returns only the owner`s circles', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })

    createCircle(db, { ownerUserId: a, name: 'Family' })
    createCircle(db, { ownerUserId: a, name: 'Roommates' })
    createCircle(db, { ownerUserId: b, name: 'Work' })

    const aCircles = listCirclesForOwner(db, a)
    expect(aCircles.map((c) => c.name).sort()).toEqual(['Family', 'Roommates'])

    const bCircles = listCirclesForOwner(db, b)
    expect(bCircles.map((c) => c.name)).toEqual(['Work'])
  })

  it('getCircle enforces owner-scoped access (returns null for others)', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })

    const { id } = createCircle(db, { ownerUserId: a, name: 'Family' })

    expect(getCircle(db, id, a)).not.toBeNull()
    expect(getCircle(db, id, b)).toBeNull()
  })

  it('updateCircle replaces members + renames + sets defaultPayer', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const c = createUser(sqlite, { email: 'c@t.com' })

    const { id } = createCircle(db, {
      ownerUserId: a,
      name: 'Family',
      memberIds: [b],
    })

    const ok = updateCircle(db, id, a, {
      name: 'The Family',
      memberIds: [c], // B removed, C added
      defaultPayerId: c,
    })
    expect(ok).toBe(true)

    const circle = getCircle(db, id, a)!
    expect(circle.name).toBe('The Family')
    expect(circle.memberIds.sort()).toEqual([a, c].sort()) // owner auto-kept
    expect(circle.defaultPayerId).toBe(c)
  })

  it('updateCircle rejects non-owner and returns false', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const { id } = createCircle(db, { ownerUserId: a, name: 'Family' })

    const ok = updateCircle(db, id, b, { name: 'Hijacked' })
    expect(ok).toBe(false)
    expect(getCircle(db, id, a)!.name).toBe('Family')
  })

  it('deleteCircle cascades to circle_members', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const { id } = createCircle(db, {
      ownerUserId: a,
      name: 'Family',
      memberIds: [b],
    })

    expect(deleteCircle(db, id, a)).toBe(true)
    expect(getCircle(db, id, a)).toBeNull()

    const remaining = sqlite
      .prepare(
        'SELECT COUNT(*) AS n FROM circle_members WHERE circle_id = ?'
      )
      .get(id) as { n: number }
    expect(remaining.n).toBe(0)
  })

  it('deleteCircle returns false for non-owner', () => {
    const a = createUser(sqlite, { email: 'a@t.com' })
    const b = createUser(sqlite, { email: 'b@t.com' })
    const { id } = createCircle(db, { ownerUserId: a, name: 'Family' })

    expect(deleteCircle(db, id, b)).toBe(false)
    expect(getCircle(db, id, a)).not.toBeNull()
  })

  it('no FK from subscriptions to circles — dropping a circle never affects subs', () => {
    // Snapshot invariant: circles exist purely as UX templates. This
    // test documents it by asserting the subscriptions table has no
    // circle_id column.
    const rows = sqlite.prepare('PRAGMA table_info(subscriptions)').all() as Array<{
      name: string
    }>
    const cols = rows.map((r) => r.name)
    expect(cols).not.toContain('circle_id')
  })
})

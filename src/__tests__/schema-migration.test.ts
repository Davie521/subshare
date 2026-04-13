import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '@/db/migrate'

/**
 * T3 — additive schema migration for subscription-centric redesign.
 * Tests introspect sqlite_schema to verify new columns / tables exist.
 * Legacy groups / group_members tables must remain for back-compat.
 */
function freshDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(sqlite)
  return sqlite
}

function tableInfo(sqlite: Database.Database, table: string) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
  }>
}

function tableExists(sqlite: Database.Database, table: string): boolean {
  const row = sqlite
    .prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name=?`)
    .get(table)
  return !!row
}

function indexExists(sqlite: Database.Database, name: string): boolean {
  const row = sqlite
    .prepare(`SELECT name FROM sqlite_schema WHERE type='index' AND name=?`)
    .get(name)
  return !!row
}

describe('T3 schema migration', () => {
  it('adds users.display_name (TEXT) and users.show_email (INTEGER, default 0)', () => {
    const sqlite = freshDb()
    const cols = tableInfo(sqlite, 'users')
    const displayName = cols.find((c) => c.name === 'display_name')
    const showEmail = cols.find((c) => c.name === 'show_email')

    expect(displayName).toBeDefined()
    expect(displayName!.type.toUpperCase()).toBe('TEXT')
    expect(showEmail).toBeDefined()
    expect(showEmail!.type.toUpperCase()).toBe('INTEGER')
    expect(showEmail!.dflt_value).toBe('0')
  })

  it('adds subscriptions.payer_id (INTEGER, NOT NULL)', () => {
    const sqlite = freshDb()
    const cols = tableInfo(sqlite, 'subscriptions')
    const payer = cols.find((c) => c.name === 'payer_id')
    expect(payer).toBeDefined()
    expect(payer!.type.toUpperCase()).toBe('INTEGER')
    expect(payer!.notnull).toBe(1)
  })

  it('creates subscription_members table with correct columns', () => {
    const sqlite = freshDb()
    expect(tableExists(sqlite, 'subscription_members')).toBe(true)

    const cols = tableInfo(sqlite, 'subscription_members')
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual(
      ['added_at', 'added_by', 'left_at', 'subscription_id', 'user_id'].sort()
    )

    // Composite PK on (subscription_id, user_id)
    const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name).sort()
    expect(pkCols).toEqual(['subscription_id', 'user_id'].sort())
  })

  it('creates friendships table with (user_a_id, user_b_id) composite PK', () => {
    const sqlite = freshDb()
    expect(tableExists(sqlite, 'friendships')).toBe(true)

    const cols = tableInfo(sqlite, 'friendships')
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual(['created_at', 'user_a_id', 'user_b_id'].sort())

    const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name).sort()
    expect(pkCols).toEqual(['user_a_id', 'user_b_id'].sort())
  })

  it('enforces a < b convention via CHECK constraint', () => {
    const sqlite = freshDb()
    sqlite
      .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run('A', 'a@t', 'x')
    sqlite
      .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run('B', 'b@t', 'x')

    // Valid direction
    expect(() =>
      sqlite
        .prepare('INSERT INTO friendships (user_a_id, user_b_id) VALUES (?, ?)')
        .run(1, 2)
    ).not.toThrow()

    // Invalid: a >= b
    expect(() =>
      sqlite
        .prepare('INSERT INTO friendships (user_a_id, user_b_id) VALUES (?, ?)')
        .run(2, 1)
    ).toThrow(/CHECK constraint/)
  })

  it('creates notifications table with required columns + index', () => {
    const sqlite = freshDb()
    expect(tableExists(sqlite, 'notifications')).toBe(true)

    const cols = tableInfo(sqlite, 'notifications')
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'created_at',
        'id',
        'payload',
        'read_at',
        'subscription_id',
        'type',
        'user_id',
      ].sort()
    )

    expect(indexExists(sqlite, 'notif_user_unread')).toBe(true)
  })

  it('keeps legacy groups and group_members tables intact', () => {
    const sqlite = freshDb()
    expect(tableExists(sqlite, 'groups')).toBe(true)
    expect(tableExists(sqlite, 'group_members')).toBe(true)
  })

  it('migration is idempotent (running twice does not error)', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    migrate(sqlite)
    expect(() => migrate(sqlite)).not.toThrow()
  })
})

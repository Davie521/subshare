import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'
import { migrate } from '@/db/migrate'
import { hashSync } from 'bcryptjs'

export function setupTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrate(sqlite)
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

/** Insert a test user and return their id */
export function createUser(
  sqlite: Database.Database,
  opts: { name?: string; email?: string; currency?: string } = {}
) {
  const name = opts.name || 'Test User'
  const email = opts.email || `user${Date.now()}@test.com`
  const currency = opts.currency || 'CNY'
  const hash = hashSync('password123', 10)

  const result = sqlite
    .prepare(
      'INSERT INTO users (name, email, password_hash, preferred_currency) VALUES (?, ?, ?, ?)'
    )
    .run(name, email, hash, currency)

  return Number(result.lastInsertRowid)
}

/** Insert a test group and return its id + publicId */
export function createGroup(
  sqlite: Database.Database,
  opts: { name?: string; createdBy: number; publicId?: string; currency?: string }
) {
  const name = opts.name || 'Test Group'
  const publicId = opts.publicId || `test-${Date.now()}`
  const currency = opts.currency || 'CNY'

  const result = sqlite
    .prepare(
      'INSERT INTO groups (name, public_id, created_by, default_currency) VALUES (?, ?, ?, ?)'
    )
    .run(name, publicId, opts.createdBy, currency)

  // Auto-add creator as member
  sqlite
    .prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)')
    .run(Number(result.lastInsertRowid), opts.createdBy)

  return {
    id: Number(result.lastInsertRowid),
    publicId,
  }
}

/** Add a member to a group */
export function addMember(
  sqlite: Database.Database,
  groupId: number,
  userId: number
) {
  sqlite
    .prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)')
    .run(groupId, userId)
}

/**
 * Direct-insert a subscription member via SQL — bypasses
 * addMemberToSubscription's auto-pro-rata side effect. Use this when
 * a test needs a member present before generateAndSaveBillingRecords
 * without any R2 pro-rata bill getting in the way.
 */
export function addSubMember(
  sqlite: Database.Database,
  subscriptionId: number,
  userId: number,
  opts: { addedBy?: number; addedAt?: string } = {}
) {
  const addedBy = opts.addedBy ?? userId
  const addedAt = opts.addedAt ?? '2026-01-01'
  sqlite
    .prepare(
      'INSERT OR IGNORE INTO subscription_members (subscription_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)'
    )
    .run(subscriptionId, userId, addedBy, addedAt)
}

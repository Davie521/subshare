import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import path from 'path'

const DB_PATH = process.env.DATABASE_URL || path.join(process.cwd(), 'data', 'subshare.db')

let sqlite: Database.Database | null = null

export function getDb() {
  if (!sqlite) {
    sqlite = new Database(DB_PATH)
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
  }
  return drizzle(sqlite, { schema })
}

/** For testing: create an in-memory database */
export function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

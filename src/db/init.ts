import Database from 'better-sqlite3'
import { migrate } from './migrate'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DATABASE_URL || path.join(process.cwd(), 'data', 'subshare.db')

export function initDatabase() {
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const sqlite = new Database(DB_PATH)
  migrate(sqlite)
  sqlite.close()
}

// Auto-init when imported in server context
if (typeof window === 'undefined') {
  initDatabase()
}

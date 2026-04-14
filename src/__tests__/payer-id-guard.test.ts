import { describe, it, expect } from 'vitest'
import { setupTestDb } from './helpers'
import { migrate } from '@/db/migrate'

/**
 * Post-Postgres-migration: the legacy SQLite path that simulated a pre-
 * payer_id schema and ran ALTER TABLE backfill no longer exists. Fresh
 * Postgres databases get payer_id as NOT NULL from day one, and the
 * H1 guard in migrate() runs an orphan check that we exercise here.
 */

describe('T17 migration payer_id guard', () => {
  it('guard passes on a freshly migrated DB with no orphan rows', async () => {
    const { db } = await setupTestDb()
    await expect(migrate(db)).resolves.not.toThrow()
  })

  it('guard throws when a subscription has payer_id IS NULL', async () => {
    const { db, sqlite } = await setupTestDb()

    await sqlite.exec(
      'ALTER TABLE subscriptions ALTER COLUMN payer_id DROP NOT NULL'
    )
    await sqlite.prepare(
      "INSERT INTO users (id, name, email, password_hash) VALUES (99, 'Z', 'z@t.com', 'x')"
    ).run()
    await sqlite.prepare(
      `INSERT INTO subscriptions
       (name, price, next_payment, start_date, owner_id, payer_id)
       VALUES ('Broken', 100, '2026-01-01', '2026-01-01', 99, NULL)`
    ).run()

    await expect(migrate(db)).rejects.toThrow(/payer_id/i)
  })
})

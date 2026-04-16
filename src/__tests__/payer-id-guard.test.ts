import { describe, it, expect, vi, afterEach } from 'vitest'
import { setupTestDb } from './helpers'
import { migrate } from '@/db/migrate'

/**
 * Post-Postgres-migration: the legacy SQLite path that simulated a pre-
 * payer_id schema and ran ALTER TABLE backfill no longer exists. Fresh
 * Postgres databases get payer_id as NOT NULL from day one, and the
 * H1 guard in await migrate() runs an orphan check that we exercise here.
 *
 * The guard logs a warning (not an exception) so an admin can boot the
 * app and repair the offending rows without editing the database by hand.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('T17 migration payer_id guard', () => {
  it('guard passes on a freshly migrated DB with no orphan rows', async () => {
    const { db } = await setupTestDb()
    await expect(migrate(db)).resolves.not.toThrow()
  })

  it('guard warns (not throws) when a subscription has payer_id IS NULL', async () => {
    const { db, sqlite } = await setupTestDb()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sqlite.exec(
      'ALTER TABLE subscriptions ALTER COLUMN payer_id DROP NOT NULL'
    )
    await sqlite.prepare(
      "INSERT INTO users (id, name, email, google_id) VALUES (99, 'Z', 'z@t.com', 'g-z')"
    ).run()
    await sqlite.prepare(
      `INSERT INTO subscriptions
       (name, price, next_payment, start_date, owner_id, payer_id)
       VALUES ('Broken', 100, '2026-01-01', '2026-01-01', 99, NULL)`
    ).run()

    await expect(migrate(db)).resolves.not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/payer_id/i))
  })
})

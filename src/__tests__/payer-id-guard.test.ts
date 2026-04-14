import { describe, it, expect } from 'vitest'
import { migrate } from '@/db/migrate'

/**
 * T17 / H1 — migration must refuse to leave subscriptions.payer_id NULL.
 *
 * Fresh DBs never hit this (CREATE TABLE enforces NOT NULL). The risk is in
 * the legacy-DB code path where ADD COLUMN is nullable; the backfill is
 * supposed to fill everything, but if a sub has a dangling group_id and
 * owner_id is somehow NULL, the row survives with payer_id NULL and every
 * downstream invariant (R7 payer guard, settlement netting) silently breaks.
 */

async function legacyDbWithPrePayerSchema(): Database.Database {
  // Simulate a DB created before the payer_id column existed.
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  await sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      public_id TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL REFERENCES users(id),
      default_currency TEXT NOT NULL DEFAULT 'CNY'
    );
    CREATE TABLE subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      next_payment TEXT NOT NULL,
      start_date TEXT NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      group_id INTEGER REFERENCES groups(id)
    );
  `)
  await sqlite.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'A', 'a@t', 'x')")
    .run()
  return sqlite
}

describe('T17 migration payer_id guard', () => {
  it('backfills payer_id=owner_id for a personal sub (happy path)', async () => {
    const sqlite = await legacyDbWithPrePayerSchema()
    await sqlite.prepare(
        `INSERT INTO subscriptions (id, name, price, next_payment, start_date, owner_id)
         VALUES (10, 'Spotify', 1500, '2026-05-01', '2026-01-01', 1)`
      )
      .run()

    await expect(migrate(sqlite)).resolves.not.toThrow()

    const row = await sqlite.prepare('SELECT payer_id FROM subscriptions WHERE id = 10')
      .get() as { payer_id: number }
    expect(row.payer_id).toBe(1)
  })

  it('throws when a subscription has no resolvable payer after backfill', async () => {
    const sqlite = await legacyDbWithPrePayerSchema()
    // Directly insert a row that violates owner_id NOT NULL — impossible
    // via the CREATE TABLE above. So instead, simulate the pathology with
    // a NULL-allowed shadow column. We recreate the table without
    // owner_id NOT NULL, insert NULL, then run migrate.
    await sqlite.exec(`
      DROP TABLE subscriptions;
      CREATE TABLE subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CNY',
        next_payment TEXT NOT NULL,
        start_date TEXT NOT NULL,
        owner_id INTEGER REFERENCES users(id),
        group_id INTEGER REFERENCES groups(id)
      );
    `)
    await sqlite.prepare(
        `INSERT INTO subscriptions (id, name, price, next_payment, start_date, owner_id)
         VALUES (11, 'Orphan', 100, '2026-05-01', '2026-01-01', NULL)`
      )
      .run()

    await expect(migrate(sqlite)).rejects.toThrow(/payer_id/i)
  })
})

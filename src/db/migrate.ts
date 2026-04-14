import Database from 'better-sqlite3'

/** Run migrations on a SQLite database instance */
export function migrate(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar TEXT,
      preferred_currency TEXT NOT NULL DEFAULT 'CNY',
      monthly_budget INTEGER,
      display_name TEXT,
      show_email INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT,
      user_id INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      public_id TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL REFERENCES users(id),
      default_currency TEXT NOT NULL DEFAULT 'CNY',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      logo TEXT,
      url TEXT,
      notes TEXT,
      price INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      next_payment TEXT NOT NULL,
      start_date TEXT NOT NULL,
      auto_renew INTEGER NOT NULL DEFAULT 1,
      inactive INTEGER NOT NULL DEFAULT 0,
      category_id INTEGER REFERENCES categories(id),
      owner_id INTEGER NOT NULL REFERENCES users(id),
      payer_id INTEGER NOT NULL REFERENCES users(id),
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      notify INTEGER NOT NULL DEFAULT 1,
      notify_days_before INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS billing_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      local_amount INTEGER NOT NULL,
      local_currency TEXT NOT NULL,
      exchange_rate REAL NOT NULL,
      billing_date TEXT NOT NULL,
      is_paid INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(subscription_id, user_id, billing_date)
    );

    CREATE TABLE IF NOT EXISTS subscription_members (
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      added_at TEXT NOT NULL,
      added_by INTEGER NOT NULL REFERENCES users(id),
      left_at TEXT,
      PRIMARY KEY (subscription_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS sub_members_by_sub
      ON subscription_members(subscription_id);

    CREATE TABLE IF NOT EXISTS friendships (
      user_a_id INTEGER NOT NULL REFERENCES users(id),
      user_b_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_a_id, user_b_id),
      CHECK (user_a_id < user_b_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );

    CREATE INDEX IF NOT EXISTS notif_user_unread
      ON notifications(user_id, read_at);

    -- Seed default categories
    INSERT OR IGNORE INTO categories (id, name, icon) VALUES
      (1, 'Entertainment', '🎬'),
      (2, 'Music', '🎵'),
      (3, 'Productivity', '⚡'),
      (4, 'Cloud Storage', '☁️'),
      (5, 'AI Tools', '🤖'),
      (6, 'Gaming', '🎮'),
      (7, 'Education', '📚'),
      (8, 'Other', '📦');
  `)

  // Idempotent column additions for databases created before the
  // subscription-centric redesign.
  function hasColumn(table: string, column: string): boolean {
    const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string
    }>
    return rows.some((r) => r.name === column)
  }

  if (!hasColumn('users', 'display_name')) {
    sqlite.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`)
  }
  if (!hasColumn('users', 'show_email')) {
    sqlite.exec(
      `ALTER TABLE users ADD COLUMN show_email INTEGER NOT NULL DEFAULT 0`
    )
  }
  if (!hasColumn('subscriptions', 'payer_id')) {
    // pre-existing live DB path: add without NOT NULL, backfill, move on.
    // Add as nullable first, backfill, then enforce via application layer.
    // (SQLite cannot retroactively add NOT NULL without a default, and we
    // don't want a placeholder user id polluting the data.)
    sqlite.exec(`ALTER TABLE subscriptions ADD COLUMN payer_id INTEGER`)
    sqlite.exec(`
      UPDATE subscriptions
      SET payer_id = COALESCE(
        (SELECT created_by FROM groups WHERE groups.id = subscriptions.group_id),
        owner_id
      )
      WHERE payer_id IS NULL
    `)
  }

  // H1 guard — refuse to leave payer_id NULL on any row. Downstream code
  // (R7 payer guard, settlement netting) treats sub.payer_id as a trusted
  // number; a leaked NULL silently breaks every invariant.
  const orphans = sqlite
    .prepare(
      `SELECT id FROM subscriptions WHERE payer_id IS NULL LIMIT 5`
    )
    .all() as Array<{ id: number }>
  if (orphans.length > 0) {
    const ids = orphans.map((o) => o.id).join(', ')
    throw new Error(
      `Migration error: subscriptions with unresolved payer_id: ${ids}. ` +
        `Fix owner_id / group_id on these rows before restarting.`
    )
  }
}

/**
 * T15 — backfill subscription_members and friendships from legacy
 * groups/group_members structures. Idempotent.
 *
 * Rules:
 *  - Each (sub with group_id, group member) → subscription_members row
 *    with addedAt = group_members.joined_at (or today if missing),
 *    addedBy = groups.created_by.
 *  - Personal sub (no group_id) that lacks any subscription_members row
 *    → insert owner as sole member.
 *  - For each (group member != group.created_by) → friendship
 *    (min, max) between creator and member.
 *
 * Returns the number of subscription_members rows that were newly inserted
 * (useful for scripts that want to report progress).
 */
export function backfillFromGroups(sqlite: Database.Database): number {
  let insertedMembers = 0

  const today = new Date().toISOString().slice(0, 10)

  // Step 1 — shared subscriptions.
  const sharedPairs = sqlite
    .prepare(
      `
      SELECT s.id AS sub_id,
             gm.user_id AS user_id,
             COALESCE(gm.joined_at, ?) AS added_at,
             g.created_by AS added_by
      FROM subscriptions s
      INNER JOIN groups g ON g.id = s.group_id
      INNER JOIN group_members gm ON gm.group_id = g.id
      `
    )
    .all(today) as Array<{
    sub_id: number
    user_id: number
    added_at: string
    added_by: number
  }>

  const insertMember = sqlite.prepare(
    `INSERT OR IGNORE INTO subscription_members
     (subscription_id, user_id, added_at, added_by) VALUES (?, ?, ?, ?)`
  )

  for (const p of sharedPairs) {
    const res = insertMember.run(p.sub_id, p.user_id, p.added_at, p.added_by)
    insertedMembers += Number(res.changes)
  }

  // Step 2 — personal subscriptions without a member row.
  const orphans = sqlite
    .prepare(
      `
      SELECT s.id AS sub_id, s.owner_id AS owner_id, COALESCE(s.start_date, ?) AS start
      FROM subscriptions s
      WHERE s.group_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM subscription_members m WHERE m.subscription_id = s.id
        )
      `
    )
    .all(today) as Array<{ sub_id: number; owner_id: number; start: string }>

  for (const o of orphans) {
    const res = insertMember.run(o.sub_id, o.owner_id, o.start, o.owner_id)
    insertedMembers += Number(res.changes)
  }

  // Step 3 — friendships between group creator and each other member.
  const pairs = sqlite
    .prepare(
      `
      SELECT DISTINCT g.created_by AS creator, gm.user_id AS member
      FROM groups g INNER JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id != g.created_by
      `
    )
    .all() as Array<{ creator: number; member: number }>

  const insertFriendship = sqlite.prepare(
    `INSERT OR IGNORE INTO friendships (user_a_id, user_b_id) VALUES (?, ?)`
  )

  for (const p of pairs) {
    const [lo, hi] =
      p.creator < p.member ? [p.creator, p.member] : [p.member, p.creator]
    insertFriendship.run(lo, hi)
  }

  return insertedMembers
}

import type Database from 'better-sqlite3'

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
}

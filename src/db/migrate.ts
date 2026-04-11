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
}

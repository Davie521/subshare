import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar'),
  preferredCurrency: text('preferred_currency').notNull().default('CNY'),
  monthlyBudget: integer('monthly_budget'), // BigInt cents, nullable
  displayName: text('display_name'),
  showEmail: integer('show_email').notNull().default(0),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
})

export const subscriptions = sqliteTable('subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  logo: text('logo'),
  url: text('url'),
  notes: text('notes'),
  price: integer('price').notNull(), // BigInt cents
  currency: text('currency').notNull().default('CNY'),
  nextPayment: text('next_payment').notNull(), // ISO date
  startDate: text('start_date').notNull(), // ISO date
  autoRenew: integer('auto_renew').notNull().default(1),
  inactive: integer('inactive').notNull().default(0),
  categoryId: integer('category_id').references(() => categories.id),
  ownerId: integer('owner_id')
    .notNull()
    .references(() => users.id),
  payerId: integer('payer_id')
    .notNull()
    .references(() => users.id),
  notify: integer('notify').notNull().default(1),
  notifyDaysBefore: integer('notify_days_before').notNull().default(3),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
})

export const subscriptionMembers = sqliteTable(
  'subscription_members',
  {
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    addedAt: text('added_at').notNull(),
    addedBy: integer('added_by')
      .notNull()
      .references(() => users.id),
    leftAt: text('left_at'),
  },
  (t) => [
    primaryKey({ columns: [t.subscriptionId, t.userId] }),
    index('sub_members_by_sub').on(t.subscriptionId),
  ]
)

export const friendships = sqliteTable(
  'friendships',
  {
    userAId: integer('user_a_id')
      .notNull()
      .references(() => users.id),
    userBId: integer('user_b_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
  },
  (t) => [primaryKey({ columns: [t.userAId, t.userBId] })]
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    subscriptionId: integer('subscription_id').references(
      () => subscriptions.id,
      { onDelete: 'cascade' }
    ),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
    readAt: text('read_at'),
  },
  (t) => [index('notif_user_unread').on(t.userId, t.readAt)]
)

export const billingRecords = sqliteTable(
  'billing_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(), // BigInt cents, original currency
    currency: text('currency').notNull(),
    localAmount: integer('local_amount').notNull(), // BigInt cents, user's currency
    localCurrency: text('local_currency').notNull(),
    exchangeRate: integer('exchange_rate').notNull(), // stored as rate × 1000000 for precision
    billingDate: text('billing_date').notNull(), // ISO date
    isPaid: integer('is_paid').notNull().default(0),
    paidAt: text('paid_at'),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
  },
  (table) => [
    uniqueIndex('billing_unique').on(
      table.subscriptionId,
      table.userId,
      table.billingDate
    ),
  ]
)

export const circles = sqliteTable(
  'circles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    ownerUserId: integer('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    defaultPayerId: integer('default_payer_id').references(() => users.id),
    createdAt: text('created_at').notNull().default("(datetime('now'))"),
  },
  (t) => [index('circles_by_owner').on(t.ownerUserId)]
)

export const circleMembers = sqliteTable(
  'circle_members',
  {
    circleId: integer('circle_id')
      .notNull()
      .references(() => circles.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedAt: text('added_at').notNull().default("(datetime('now'))"),
  },
  (t) => [primaryKey({ columns: [t.circleId, t.userId] })]
)

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  icon: text('icon'),
  userId: integer('user_id').references(() => users.id), // null = global default
})

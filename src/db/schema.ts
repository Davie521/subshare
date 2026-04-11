import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar'),
  preferredCurrency: text('preferred_currency').notNull().default('CNY'),
  monthlyBudget: integer('monthly_budget'), // BigInt cents, nullable
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
})

export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  publicId: text('public_id').notNull().unique(),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  defaultCurrency: text('default_currency').notNull().default('CNY'),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
})

export const groupMembers = sqliteTable(
  'group_members',
  {
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    joinedAt: text('joined_at').notNull().default("(datetime('now'))"),
  },
  (table) => [
    uniqueIndex('group_members_pk').on(table.groupId, table.userId),
  ]
)

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
  groupId: integer('group_id').references(() => groups.id, {
    onDelete: 'cascade',
  }),
  notify: integer('notify').notNull().default(1),
  notifyDaysBefore: integer('notify_days_before').notNull().default(3),
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
})

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

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  icon: text('icon'),
  userId: integer('user_id').references(() => users.id), // null = global default
})

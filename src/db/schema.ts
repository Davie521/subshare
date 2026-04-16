import {
  pgTable,
  text,
  integer,
  boolean,
  uniqueIndex,
  primaryKey,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const isoNow = () => new Date().toISOString()

export const users = pgTable('users', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  googleId: text('google_id').unique(),
  avatar: text('avatar'),
  preferredCurrency: text('preferred_currency').notNull().default('CNY'),
  monthlyBudget: integer('monthly_budget'), // BigInt cents, nullable
  displayName: text('display_name'),
  showEmail: boolean('show_email').notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(isoNow),
})

export const groups = pgTable('groups', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  name: text('name').notNull(),
  publicId: text('public_id').notNull().unique(),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  defaultCurrency: text('default_currency').notNull().default('CNY'),
  createdAt: text('created_at').notNull().$defaultFn(isoNow),
})

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    joinedAt: text('joined_at').notNull().$defaultFn(isoNow),
  },
  (table) => [
    uniqueIndex('group_members_pk').on(table.groupId, table.userId),
  ]
)

export const subscriptions = pgTable('subscriptions', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  name: text('name').notNull(),
  logo: text('logo'),
  url: text('url'),
  notes: text('notes'),
  price: integer('price').notNull(), // BigInt cents
  currency: text('currency').notNull().default('CNY'),
  nextPayment: text('next_payment').notNull(), // ISO date
  startDate: text('start_date').notNull(), // ISO date
  autoRenew: boolean('auto_renew').notNull().default(true),
  inactive: boolean('inactive').notNull().default(false),
  categoryId: integer('category_id').references(() => categories.id),
  ownerId: integer('owner_id')
    .notNull()
    .references(() => users.id),
  payerId: integer('payer_id')
    .notNull()
    .references(() => users.id),
  groupId: integer('group_id').references(() => groups.id, {
    onDelete: 'cascade',
  }),
  notify: boolean('notify').notNull().default(true),
  notifyDaysBefore: integer('notify_days_before').notNull().default(3),
  /**
   * How to handle the diff when a leaver's bill shrinks mid-month:
   *   'payer_absorbs' — payer eats the loss; other members unchanged.
   *   'redistribute' — split the diff across other unpaid non-payer
   *     members (falls back to 'payer_absorbs' if none exist).
   */
  refundPolicy: text('refund_policy').notNull().default('payer_absorbs'),
  createdAt: text('created_at').notNull().$defaultFn(isoNow),
}, (t) => [
  check(
    'subscriptions_refund_policy_valid',
    sql`${t.refundPolicy} IN ('payer_absorbs', 'redistribute')`
  ),
])

export const subscriptionMembers = pgTable(
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

export const friendships = pgTable(
  'friendships',
  {
    userAId: integer('user_a_id')
      .notNull()
      .references(() => users.id),
    userBId: integer('user_b_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull().$defaultFn(isoNow),
    /**
     * Currency userA prefers when settling with userB.
     * Per-row override of preferredCurrency. Asymmetric per friend: each
     * side keeps their own override.
     */
    agreedCurrencyA: text('agreed_currency_a'),
    /** Same as `agreedCurrencyA` but for userB. */
    agreedCurrencyB: text('agreed_currency_b'),
  },
  (t) => [
    primaryKey({ columns: [t.userAId, t.userBId] }),
    check('friendships_ordered', sql`${t.userAId} < ${t.userBId}`),
  ]
)

export const notifications = pgTable(
  'notifications',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    subscriptionId: integer('subscription_id').references(
      () => subscriptions.id,
      { onDelete: 'cascade' }
    ),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(isoNow),
    readAt: text('read_at'),
  },
  (t) => [index('notif_user_unread').on(t.userId, t.readAt)]
)

export const billingRecords = pgTable(
  'billing_records',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
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
    isPaid: boolean('is_paid').notNull().default(false),
    paidAt: text('paid_at'),
    createdAt: text('created_at').notNull().$defaultFn(isoNow),
  },
  (table) => [
    uniqueIndex('billing_unique').on(
      table.subscriptionId,
      table.userId,
      table.billingDate
    ),
  ]
)

export const categories = pgTable('categories', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  name: text('name').notNull(),
  icon: text('icon'),
  userId: integer('user_id').references(() => users.id), // null = global default
})

export const circles = pgTable(
  'circles',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    name: text('name').notNull(),
    ownerUserId: integer('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    defaultPayerId: integer('default_payer_id').references(() => users.id),
    createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [index('circles_by_owner').on(t.ownerUserId)]
)

export const circleMembers = pgTable(
  'circle_members',
  {
    circleId: integer('circle_id')
      .notNull()
      .references(() => circles.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedAt: text('added_at').notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [primaryKey({ columns: [t.circleId, t.userId] })]
)

export const invites = pgTable(
  'invites',
  {
    token: text('token').primaryKey(),
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    inviterId: integer('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    maxUses: integer('max_uses').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull().$defaultFn(isoNow),
  },
  (t) => [index('invites_by_sub').on(t.subscriptionId)]
)

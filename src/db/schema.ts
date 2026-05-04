import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  primaryKey,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { SubscriptionTag } from '@/types/tags'

export type { SubscriptionTag } from '@/types/tags'

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
  /**
   * User-authored tags — max 5 enforced at the app layer. Each tag has its
   * own visibility ('public' | 'private'); non-payer viewers only see
   * public tags.
   */
  tags: jsonb('tags')
    .$type<SubscriptionTag[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /**
   * Per-day price timeline. Each entry is `{ price, effectiveFrom }`
   * where `price` is monthly cents and `effectiveFrom` is an inclusive
   * ISO date — from that day forward (until the next entry's
   * effectiveFrom) the engine charges this monthly rate per-day-pro-rata.
   *
   * The engine reads this column when computing per-day fair shares so
   * a mid-month price change blends across the affected calendar
   * month. `subscriptions.price` is kept as a denormalized cache of the
   * latest entry whose `effectiveFrom <= today`.
   *
   * On insert, we backfill a single entry `{ price, effectiveFrom = startDate }`
   * so legacy single-price subs still produce well-formed timelines.
   */
  priceHistory: jsonb('price_history')
    .$type<Array<{ price: number; effectiveFrom: string }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
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
    /**
     * Per-member private tags — only the row's user_id can read or
     * write these. Separate bucket from `subscriptions.tags` (which is
     * owner/payer-authored with a public/private visibility axis).
     * Max 5 enforced at the app layer. Shape mirrors `subscriptions.tags`
     * (SubscriptionTag[]) so helpers like `normalizeTags` can be reused;
     * the visibility field is always `'private'` here.
     */
    personalTags: jsonb('personal_tags')
      .$type<SubscriptionTag[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Closed [addedAt, leftAt] intervals from earlier stints when a
     * member leaves and is later re-added. The current row's
     * (addedAt, leftAt) is the active stint; everything in
     * `previousIntervals` is settled history. The fair-engine expands
     * this array + the current interval when computing per-day fair
     * shares so a rejoiner is correctly billed for every day they used.
     */
    previousIntervals: jsonb('previous_intervals')
      .$type<Array<{ addedAt: string; leftAt: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
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
    /**
     * Cents in `currency`. Signed: negative for refund adjustments,
     * positive for top-up adjustments and regular bills.
     */
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    /**
     * Cents in `localCurrency`. Same sign as `amount`.
     */
    localAmount: integer('local_amount').notNull(),
    localCurrency: text('local_currency').notNull(),
    exchangeRate: integer('exchange_rate').notNull(), // stored as rate × 1000000 for precision
    billingDate: text('billing_date').notNull(), // ISO date
    isPaid: boolean('is_paid').notNull().default(false),
    paidAt: text('paid_at'),
    /**
     * NULL for regular bills (R1 + R2). Set when this row is a retroactive
     * adjustment created against a previously-billed row (the `id` of the
     * parent bill being adjusted). Adjustment rows may share `billing_date`
     * with their parent — partial unique index excludes them so the
     * "one bill per (sub, user, billing_date)" invariant only applies to
     * non-adjustment rows.
     */
    adjustmentForBillId: integer('adjustment_for_bill_id'),
    /**
     * Idempotency key for the event that produced this row (e.g.,
     * `editAddedAt:sub24:userId5:2026-05-03T08:59`). Lets retried
     * recompute calls upsert by event rather than insert duplicates.
     * NULL for legacy rows pre-dating the new engine.
     */
    eventId: text('event_id'),
    createdAt: text('created_at').notNull().$defaultFn(isoNow),
  },
  (table) => [
    // Partial unique: only enforced on regular bills (adjustments may
    // share billing_date with the parent bill they offset).
    uniqueIndex('billing_unique')
      .on(table.subscriptionId, table.userId, table.billingDate)
      .where(sql`adjustment_for_bill_id IS NULL`),
    // Idempotency: at most one row per (sub, user, eventId) — retries of
    // the same recompute event upsert rather than duplicate.
    uniqueIndex('billing_event_unique')
      .on(table.subscriptionId, table.userId, table.eventId)
      .where(sql`event_id IS NOT NULL`),
    // Look-up index for "all adjustments against bill X".
    index('billing_by_parent').on(table.adjustmentForBillId),
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

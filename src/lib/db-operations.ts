import { eq, and, sql, inArray, isNull, or, gt, lte } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import type { SubscriptionTag } from '@/db/schema'
import { filterTagsForViewer, normalizeTags } from './tags'
import { todayInAppTz } from './date-utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

/**
 * Acquire a row-level write lock on a subscription for the duration of
 * the current transaction. Every critical path that mutates membership,
 * pricing, or billing for a given sub calls this FIRST so that concurrent
 * invocations serialize on the same row instead of reading stale member
 * snapshots and computing inconsistent shares.
 *
 * Must be called inside a `db.transaction` callback — outside one, the
 * lock is released as soon as this query returns (useless).
 */
export async function lockSubscription(
  tx: DB,
  subscriptionId: number
): Promise<void> {
  await tx
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subscriptionId))
    .for('update')
}

export async function createSubscription(
  db: DB,
  input: {
    name: string
    price: number
    currency: string
    nextPayment: string
    ownerId: number
    payerId?: number
    logo?: string | null
    url?: string
    notes?: string
    categoryId?: number
    startDate?: string // defaults to today; owner's addedAt matches this
    refundPolicy?: 'payer_absorbs' | 'redistribute'
    tags?: SubscriptionTag[]
  }
): Promise<{ id: number; name: string }> {
  const today = todayInAppTz()
  const startDate = input.startDate ?? today

  return db.transaction(async (tx) => {
    const [result] = await tx
      .insert(schema.subscriptions)
      .values({
        name: input.name,
        price: input.price,
        currency: input.currency,
        nextPayment: input.nextPayment,
        startDate,
        ownerId: input.ownerId,
        payerId: input.payerId ?? input.ownerId,
        logo: input.logo ?? null,
        url: input.url ?? null,
        notes: input.notes ?? null,
        categoryId: input.categoryId ?? null,
        refundPolicy: input.refundPolicy ?? 'payer_absorbs',
        tags: normalizeTags(input.tags),
        // Seed a one-entry timeline so the engine always has a
        // well-formed price history to read.
        priceHistory: [{ price: input.price, effectiveFrom: startDate }],
      })
      .returning()

    // Owner is automatically the first member (and payer by default).
    await tx.insert(schema.subscriptionMembers)
      .values({
        subscriptionId: result.id,
        userId: input.ownerId,
        addedBy: input.ownerId,
        addedAt: startDate,
      })
      .onConflictDoNothing()

    return { id: result.id, name: result.name }
  })
}

/**
 * Active membership at a specific date. A member is active iff:
 *   addedAt <= atDate  AND  (leftAt IS NULL OR leftAt > atDate)
 *
 * leftAt is the first day the member is no longer on the service, so a
 * member whose leftAt equals atDate is NOT active that day. Using strict
 * > here prevents R1 from billing someone kicked on the 1st.
 */
export async function getActiveMembersAt(
  db: DB,
  subscriptionId: number,
  atDate: string
): Promise<Array<{
  userId: number
  addedAt: string
  addedBy: number
  leftAt: string | null
}>> {
  return db
    .select({
      userId: schema.subscriptionMembers.userId,
      addedAt: schema.subscriptionMembers.addedAt,
      addedBy: schema.subscriptionMembers.addedBy,
      leftAt: schema.subscriptionMembers.leftAt,
    })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, subscriptionId),
        lte(schema.subscriptionMembers.addedAt, atDate),
        or(
          isNull(schema.subscriptionMembers.leftAt),
          gt(schema.subscriptionMembers.leftAt, atDate)
        )
      )
    )
}

export async function getMembersOfSubscription(
  db: DB,
  subscriptionId: number
): Promise<Array<{
  userId: number
  addedAt: string
  addedBy: number
  leftAt: string | null
}>> {
  return db
    .select({
      userId: schema.subscriptionMembers.userId,
      addedAt: schema.subscriptionMembers.addedAt,
      addedBy: schema.subscriptionMembers.addedBy,
      leftAt: schema.subscriptionMembers.leftAt,
    })
    .from(schema.subscriptionMembers)
    .where(eq(schema.subscriptionMembers.subscriptionId, subscriptionId))
    
}

export async function getSubscriptionsForUser(
  db: DB,
  userId: number
): Promise<Array<{
  id: number
  name: string
  price: number
  currency: string
  nextPayment: string
  memberCount: number
  tags: SubscriptionTag[]
  personalTags: SubscriptionTag[]
  logo: string | null
}>> {
  // All subs the user is an active member of (subscription_members is
  // authoritative). Covers both owned personal subs (owner auto-added on
  // create) and shared subs where the user was added later.
  const memberRows = await db
    .select({
      subscriptionId: schema.subscriptionMembers.subscriptionId,
      personalTags: schema.subscriptionMembers.personalTags,
    })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.userId, userId),
        isNull(schema.subscriptionMembers.leftAt)
      )
    )
  const subIds = memberRows.map((r) => r.subscriptionId)
  const personalTagsBySub = new Map(
    memberRows.map((r) => [r.subscriptionId, r.personalTags])
  )

  if (subIds.length === 0) return []

  const rows = await db
    .select({
      id: schema.subscriptions.id,
      name: schema.subscriptions.name,
      price: schema.subscriptions.price,
      currency: schema.subscriptions.currency,
      nextPayment: schema.subscriptions.nextPayment,
      ownerId: schema.subscriptions.ownerId,
      payerId: schema.subscriptions.payerId,
      tags: schema.subscriptions.tags,
      logo: schema.subscriptions.logo,
      memberCount: sql<number>`(
        SELECT count(*)::int FROM subscription_members
        WHERE subscription_id = ${schema.subscriptions.id}
          AND left_at IS NULL
      )`,
    })
    .from(schema.subscriptions)
    .where(inArray(schema.subscriptions.id, subIds))

  return rows.map((r) => {
    const privileged = userId === r.ownerId || userId === r.payerId
    return {
      id: r.id,
      name: r.name,
      price: r.price,
      currency: r.currency,
      nextPayment: r.nextPayment,
      memberCount: r.memberCount,
      tags: filterTagsForViewer(r.tags, privileged),
      personalTags: personalTagsBySub.get(r.id) ?? [],
      logo: r.logo,
    }
  })
}

/**
 * R1 monthly cron. On the 1st of month `yearMonth`, insert one billing_record
 * per active non-payer member per shared subscription.
 *
 * Active members = await getActiveMembersAt(sub.id, '<YYYY-MM>-01').
 * Share = floor(price / activeMemberCount).
 * Skips personal subs (no co-members).
 * Idempotent via UNIQUE(subscription_id, user_id, billing_date).
 *
 * @param yearMonth like '2026-05'
 * @param rates optional FX map, keys like 'USD_CNY' → numeric rate
 * @returns number of bills inserted
 */

export async function getPendingBills(
  db: DB,
  userId: number
): Promise<Array<{
  id: number
  subscriptionName: string
  amount: number
  currency: string
  localAmount: number
  localCurrency: string
  billingDate: string
  isPaid: boolean
}>> {
  return db
    .select({
      id: schema.billingRecords.id,
      subscriptionName: schema.subscriptions.name,
      amount: schema.billingRecords.amount,
      currency: schema.billingRecords.currency,
      localAmount: schema.billingRecords.localAmount,
      localCurrency: schema.billingRecords.localCurrency,
      billingDate: schema.billingRecords.billingDate,
      isPaid: schema.billingRecords.isPaid,
    })
    .from(schema.billingRecords)
    .innerJoin(
      schema.subscriptions,
      eq(schema.billingRecords.subscriptionId, schema.subscriptions.id)
    )
    .where(
      and(
        eq(schema.billingRecords.userId, userId),
        eq(schema.billingRecords.isPaid, false)
      )
    )
    
}

export async function markBillPaid(db: DB, billId: number): Promise<void> {
  await db.update(schema.billingRecords)
    .set({
      isPaid: true,
      paidAt: new Date().toISOString(),
    })
    .where(eq(schema.billingRecords.id, billId))
    
}

export async function getMonthlySpendingData(
  db: DB,
  userId: number
): Promise<Array<{
  id: number
  name: string
  price: number
  currency: string
  memberCount: number
  logo: string | null
}>> {
  const subs = await getSubscriptionsForUser(db, userId)
  return subs.map((s) => ({
    id: s.id,
    name: s.name,
    price: s.price,
    currency: s.currency,
    memberCount: s.memberCount,
    logo: s.logo,
  }))
}


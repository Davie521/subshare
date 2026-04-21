import { eq, and, inArray, or, desc, isNull } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import type { SubscriptionTag } from '@/db/schema'
import {
  createSubscription,
  getPendingBills,
  markBillPaid,
  getMonthlySpendingData,
  addMemberToSubscription,
  leaveSubscription,
  changeSubscriptionPrice,
  generateMonthlyBills,
} from './db-operations'
import { normalizeTags } from './tags'
import { calculateMonthlySpending } from './billing'
import { getRate } from './fx-cache'
import {
  getNormalizedSettlement,
  getAgreedCurrencyMap,
  type NormalizedSettlementRow,
  markPairSettled,
} from './settlement'
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  countUnreadNotifications,
  syncSettlementDueNotifications,
  type NotificationRecord,
} from './notifications'
import {
  createCircle,
  listCirclesForOwner,
  getCircle,
  updateCircle,
  deleteCircle,
  type CircleSummary,
} from './circles'
import { CURRENCIES } from './validators'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export type ResultErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'INTERNAL'

export type Result<T = unknown> =
  | { success: true; data?: T }
  | { success: false; error: string; code?: ResultErrorCode }

/** Map a Result error code to an HTTP status code. */
export function statusForResultCode(code: ResultErrorCode | undefined): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404
    case 'FORBIDDEN':
      return 403
    case 'CONFLICT':
      return 409
    case 'INTERNAL':
      return 500
    case 'VALIDATION_ERROR':
    default:
      return 400
  }
}

export async function handleCreateSubscription(
  db: DB,
  userId: number,
  input: {
    name: string
    price: number
    currency: string
    nextPayment: string
    members?: number[]
    payerId?: number
    refundPolicy?: 'payer_absorbs' | 'redistribute'
    logo?: string | null
    url?: string
    notes?: string
    categoryId?: number
    tags?: SubscriptionTag[]
  }
): Promise<Result<{ id: number; name: string }>> {
  const invitees = (input.members ?? []).filter((id) => id !== userId)
  const payerId = input.payerId ?? userId

  // payer must be the owner or one of the invitees.
  if (payerId !== userId && !invitees.includes(payerId)) {
    return {
      success: false,
      error: 'payerId must be the owner or one of the members',
      code: 'VALIDATION_ERROR',
    }
  }

  const sub = await createSubscription(db, {
    ...input,
    ownerId: userId,
    payerId,
  })

  // Seed invitees. Rates are needed for cross-currency R2 bills.
  if (invitees.length > 0) {
    const rates = await fetchRatesForUsers(db, invitees, input.currency)
    const today = new Date().toISOString().slice(0, 10)
    for (const uid of invitees) {
      await addMemberToSubscription(
        db,
        {
          subscriptionId: sub.id,
          userId: uid,
          addedBy: userId,
          addedAt: today,
        },
        rates
      )
    }
  }

  return { success: true, data: sub }
}

export async function fetchRatesForUsers(
  db: DB,
  userIds: number[],
  subCurrency: string
): Promise<Record<string, number>> {
  if (userIds.length === 0) return {}
  const rows = await db
    .select({ preferredCurrency: schema.users.preferredCurrency })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds))
    
  const targets = new Set(
    rows.map((r) => r.preferredCurrency).filter((c) => c !== subCurrency)
  )
  const rates: Record<string, number> = {}
  await Promise.all(
    Array.from(targets).map(async (to) => {
      const rate = await getRate(subCurrency, to)
      if (rate !== null) rates[`${subCurrency}_${to}`] = rate
    })
  )
  return rates
}

export async function handleAddMembers(
  db: DB,
  actorId: number,
  subId: number,
  memberIds: number[]
): Promise<Result<{ added: number; reactivated: number; errors: Array<{ userId: number; error: string }> }>> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))

  if (!sub) {
    return { success: false, error: 'Subscription not found', code: 'NOT_FOUND' }
  }

  if (sub.ownerId !== actorId && sub.payerId !== actorId) {
    return {
      success: false,
      error: 'Only the owner or payer can add members',
      code: 'FORBIDDEN',
    }
  }

  const invitees = Array.from(new Set(memberIds.filter((id) => id !== actorId)))
  if (invitees.length === 0) {
    return { success: true, data: { added: 0, reactivated: 0, errors: [] } }
  }

  const rates = await fetchRatesForUsers(db, invitees, sub.currency)
  const today = new Date().toISOString().slice(0, 10)
  let added = 0
  let reactivated = 0
  const errors: Array<{ userId: number; error: string }> = []

  for (const uid of invitees) {
    try {
      const [existing] = await db
        .select({ leftAt: schema.subscriptionMembers.leftAt })
        .from(schema.subscriptionMembers)
        .where(
          and(
            eq(schema.subscriptionMembers.subscriptionId, subId),
            eq(schema.subscriptionMembers.userId, uid)
          )
        )

      if (existing && existing.leftAt === null) {
        // Genuinely active member — nothing to do.
        continue
      }

      if (existing && existing.leftAt !== null) {
        // Reactivate a departed member: clear leftAt, refresh addedAt/addedBy.
        await db
          .update(schema.subscriptionMembers)
          .set({ leftAt: null, addedAt: today, addedBy: actorId })
          .where(
            and(
              eq(schema.subscriptionMembers.subscriptionId, subId),
              eq(schema.subscriptionMembers.userId, uid)
            )
          )
        reactivated++
        continue
      }

      await addMemberToSubscription(
        db,
        { subscriptionId: subId, userId: uid, addedBy: actorId, addedAt: today },
        rates
      )
      added++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ userId: uid, error: message })
    }
  }

  return { success: true, data: { added, reactivated, errors } }
}

export async function handleRemoveMember(
  db: DB,
  actorId: number,
  subId: number,
  targetUserId: number
): Promise<Result> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))
    
  if (!sub) return { success: false, error: 'Subscription not found', code: 'NOT_FOUND' }

  const isSelf = actorId === targetUserId
  if (!isSelf && sub.ownerId !== actorId && sub.payerId !== actorId) {
    return {
      success: false,
      error: 'Only the owner or payer can remove another member',
      code: 'FORBIDDEN',
    }
  }

  try {
    await leaveSubscription(db, {
      subscriptionId: subId,
      userId: targetUserId,
      leftAt: new Date().toISOString().slice(0, 10),
      actorId,
    })
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to remove member',
      code: 'VALIDATION_ERROR',
    }
  }
  return { success: true }
}

/**
 * A10 — billing cron dispatcher. Runs on every invocation; only kicks
 * off the R1 monthly pass when today is the 1st of the month. Rates are
 * fetched once per (from, to) pair touched by any shared subscription.
 */
export async function runBillingCron(
  db: DB,
  opts: { today?: string } = {}
): Promise<Result<{ monthlyBillsGenerated: number }>> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const [year, month, day] = today.split('-').map(Number)
  if (day !== 1) {
    return { success: true, data: { monthlyBillsGenerated: 0 } }
  }

  const yearMonth = `${year}-${String(month).padStart(2, '0')}`

  // Pre-load rates for every (sub.currency, member.preferredCurrency) pair.
  const pairs = await db
    .select({
      subCurrency: schema.subscriptions.currency,
      memberCurrency: schema.users.preferredCurrency,
    })
    .from(schema.subscriptionMembers)
    .innerJoin(
      schema.subscriptions,
      eq(schema.subscriptionMembers.subscriptionId, schema.subscriptions.id)
    )
    .innerJoin(
      schema.users,
      eq(schema.subscriptionMembers.userId, schema.users.id)
    )
    .where(eq(schema.subscriptions.inactive, false))
    

  const need = new Set<string>()
  for (const p of pairs) {
    if (p.subCurrency !== p.memberCurrency) {
      need.add(`${p.subCurrency}_${p.memberCurrency}`)
    }
  }

  const rates: Record<string, number> = {}
  await Promise.all(
    Array.from(need).map(async (key) => {
      const [from, to] = key.split('_')
      const rate = await getRate(from, to)
      if (rate !== null) rates[key] = rate
    })
  )

  const generated = await generateMonthlyBills(db, yearMonth, rates)
  return { success: true, data: { monthlyBillsGenerated: generated } }
}

export type EnrichedNormalizedSettlementRow = NormalizedSettlementRow & {
  counterpartyName: string
}

const CURRENCY_WHITELIST: ReadonlySet<string> = new Set(CURRENCIES)

export async function handleGetSettlement(
  db: DB,
  userId: number
): Promise<Result<EnrichedNormalizedSettlementRow[]>> {
  const [viewer] = await db
    .select({ preferredCurrency: schema.users.preferredCurrency })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  const displayCurrency = viewer?.preferredCurrency || 'CNY'

  const agreedMap = await getAgreedCurrencyMap(db, userId)
  const rows = await getNormalizedSettlement(
    db,
    userId,
    displayCurrency,
    (counterparty) => agreedMap.get(counterparty) ?? displayCurrency
  )
  if (rows.length === 0) return { success: true, data: [] }

  const counterpartyIds = Array.from(
    new Set(rows.map((r) => r.counterpartyUserId))
  )
  const users = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, counterpartyIds))

  const byId = new Map(users.map((u) => [u.id, u]))

  const enriched: EnrichedNormalizedSettlementRow[] = rows.map((r) => {
    const u = byId.get(r.counterpartyUserId)
    const counterpartyName = u?.displayName?.trim() || u?.name || 'Unknown'
    return { ...r, counterpartyName }
  })
  return { success: true, data: enriched }
}

export async function handleMarkPairSettled(
  db: DB,
  userId: number,
  counterpartyUserId: number,
  currency?: string
): Promise<Result<{ marked: number }>> {
  if (userId === counterpartyUserId) {
    return { success: false, error: 'Cannot settle with yourself', code: 'VALIDATION_ERROR' }
  }
  if (currency !== undefined && !CURRENCY_WHITELIST.has(currency)) {
    return { success: false, error: 'Unsupported currency', code: 'VALIDATION_ERROR' }
  }
  const marked = await markPairSettled(db, {
    userA: userId,
    userB: counterpartyUserId,
    currency,
  })
  await Promise.all([
    syncSettlementDueNotifications(db, userId),
    syncSettlementDueNotifications(db, counterpartyUserId),
  ])
  return { success: true, data: { marked } }
}

export interface FriendSharedSub {
  id: number
  name: string
  price: number
  currency: string
  memberCount: number
  myShare: number
  logo: string | null
}

export interface FriendNet {
  currency: string
  /** Positive = they owe me; Negative = I owe them. */
  net: number
}

export interface FriendRow {
  userId: number
  displayName: string
  email?: string
  since: string
  sharedSubs: FriendSharedSub[]
  nets: FriendNet[]
  /** Per-friend currency override, null if using preferredCurrency. */
  agreedCurrency: string | null
}

export async function handleListFriends(
  db: DB,
  userId: number
): Promise<Result<FriendRow[]>> {
  const rows = await db
    .select({
      userAId: schema.friendships.userAId,
      userBId: schema.friendships.userBId,
      since: schema.friendships.createdAt,
      agreedCurrencyA: schema.friendships.agreedCurrencyA,
      agreedCurrencyB: schema.friendships.agreedCurrencyB,
    })
    .from(schema.friendships)
    .where(
      or(
        eq(schema.friendships.userAId, userId),
        eq(schema.friendships.userBId, userId)
      )
    )
    .orderBy(desc(schema.friendships.createdAt))
    

  if (rows.length === 0) return { success: true, data: [] }

  const otherIds = rows.map((r) =>
    r.userAId === userId ? r.userBId : r.userAId
  )
  const users = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      displayName: schema.users.displayName,
      email: schema.users.email,
      showEmail: schema.users.showEmail,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, otherIds))
  const byId = new Map(users.map((u) => [u.id, u]))

  // Shared subs per friend: every active sub where both me and friend
  // are in subscription_members.
  const coMembers = await db
    .select({
      subscriptionId: schema.subscriptionMembers.subscriptionId,
      userId: schema.subscriptionMembers.userId,
    })
    .from(schema.subscriptionMembers)
    .where(
      and(
        inArray(schema.subscriptionMembers.userId, [userId, ...otherIds]),
        isNull(schema.subscriptionMembers.leftAt)
      )
    )

  // Per sub: set of active user ids.
  const subToMembers = new Map<number, Set<number>>()
  for (const r of coMembers) {
    const s = subToMembers.get(r.subscriptionId) ?? new Set<number>()
    s.add(r.userId)
    subToMembers.set(r.subscriptionId, s)
  }

  const mySubIds: number[] = []
  for (const [subId, members] of subToMembers) {
    if (members.has(userId)) mySubIds.push(subId)
  }

  const subRows =
    mySubIds.length > 0
      ? (
          await db
            .select({
              id: schema.subscriptions.id,
              name: schema.subscriptions.name,
              price: schema.subscriptions.price,
              currency: schema.subscriptions.currency,
              inactive: schema.subscriptions.inactive,
              logo: schema.subscriptions.logo,
            })
            .from(schema.subscriptions)
            .where(inArray(schema.subscriptions.id, mySubIds))
        ).filter((s) => !s.inactive)
      : []
  const subById = new Map(subRows.map((s) => [s.id, s]))

  // Net balance per (me, friend, currency) from unpaid bills.
  const bills = await db
    .select({
      subscriptionId: schema.billingRecords.subscriptionId,
      userId: schema.billingRecords.userId,
      amount: schema.billingRecords.amount,
      currency: schema.billingRecords.currency,
      payerId: schema.subscriptions.payerId,
    })
    .from(schema.billingRecords)
    .innerJoin(
      schema.subscriptions,
      eq(schema.billingRecords.subscriptionId, schema.subscriptions.id)
    )
    .where(
      and(
        eq(schema.billingRecords.isPaid, false),
        or(
          and(
            eq(schema.billingRecords.userId, userId),
            inArray(schema.subscriptions.payerId, otherIds)
          ),
          and(
            inArray(schema.billingRecords.userId, otherIds),
            eq(schema.subscriptions.payerId, userId)
          )
        )
      )
    )

  // net[friendId][currency] = signed cents (positive = they owe me).
  const netMap = new Map<number, Map<string, number>>()
  for (const b of bills) {
    const iOwe = b.userId === userId
    const friend = iOwe ? b.payerId : b.userId
    const cur = b.currency
    const byCur = netMap.get(friend) ?? new Map<string, number>()
    byCur.set(cur, (byCur.get(cur) ?? 0) + (iOwe ? -b.amount : +b.amount))
    netMap.set(friend, byCur)
  }

  const result: FriendRow[] = rows
    .map((r) => {
      const other = r.userAId === userId ? r.userBId : r.userAId
      const u = byId.get(other)
      if (!u) return null

      const sharedSubs: FriendSharedSub[] = []
      for (const subId of mySubIds) {
        const subMembers = subToMembers.get(subId)
        const sub = subById.get(subId)
        if (!subMembers || !sub) continue
        if (!subMembers.has(other)) continue
        const memberCount = subMembers.size
        sharedSubs.push({
          id: sub.id,
          name: sub.name,
          price: sub.price,
          currency: sub.currency,
          memberCount,
          myShare: Math.floor(sub.price / memberCount),
          logo: sub.logo,
        })
      }

      const byCur = netMap.get(other)
      const nets: FriendNet[] = byCur
        ? Array.from(byCur.entries())
            .filter(([, v]) => v !== 0)
            .map(([currency, net]) => ({ currency, net }))
        : []

      const isViewerA = r.userAId === userId
      const agreedCurrency =
        (isViewerA ? r.agreedCurrencyA : r.agreedCurrencyB) ?? null

      const out: FriendRow = {
        userId: u.id,
        displayName: u.displayName?.trim() || u.name,
        since: r.since,
        sharedSubs,
        nets,
        agreedCurrency,
      }
      if (u.showEmail) out.email = u.email
      return out
    })
    .filter((x): x is FriendRow => x !== null)

  return { success: true, data: result }
}

/**
 * Set or clear the per-friend agreed_currency override for this viewer.
 * Pass `currency: null` to clear and fall back to preferredCurrency.
 */
export async function handleSetFriendCurrency(
  db: DB,
  viewerId: number,
  friendId: number,
  currency: string | null
): Promise<Result<{ ok: true }>> {
  if (viewerId === friendId) {
    return { success: false, error: 'Cannot set currency with yourself' }
  }
  if (currency !== null && !CURRENCY_WHITELIST.has(currency)) {
    return { success: false, error: 'Unsupported currency' }
  }

  const userA = Math.min(viewerId, friendId)
  const userB = Math.max(viewerId, friendId)
  const isViewerA = viewerId === userA

  // Friendship must exist (created by addMemberToSubscription).
  const [existing] = await db
    .select({ userAId: schema.friendships.userAId })
    .from(schema.friendships)
    .where(
      and(
        eq(schema.friendships.userAId, userA),
        eq(schema.friendships.userBId, userB)
      )
    )
  if (!existing) {
    return { success: false, error: 'Friendship not found' }
  }

  await db
    .update(schema.friendships)
    .set(
      isViewerA
        ? { agreedCurrencyA: currency }
        : { agreedCurrencyB: currency }
    )
    .where(
      and(
        eq(schema.friendships.userAId, userA),
        eq(schema.friendships.userBId, userB)
      )
    )

  // Re-sync notifications since display currency for this counterparty changed.
  await syncSettlementDueNotifications(db, viewerId)

  return { success: true, data: { ok: true } }
}

export async function handleListNotifications(
  db: DB,
  userId: number,
  limit = 50
): Promise<Result<{ items: NotificationRecord[]; unreadCount: number }>> {
  await syncSettlementDueNotifications(db, userId)
  const items = await listNotifications(db, userId, limit)
  const unreadCount = await countUnreadNotifications(db, userId)
  return { success: true, data: { items, unreadCount } }
}

export async function handleMarkNotificationRead(
  db: DB,
  userId: number,
  notificationId: number
): Promise<Result> {
  const [row] = await db
    .select({ userId: schema.notifications.userId })
    .from(schema.notifications)
    .where(eq(schema.notifications.id, notificationId))
    
  // Return 404 for both "not found" and "belongs to someone else" so the
  // endpoint doesn't confirm the existence of notifications the caller
  // has no right to see.
  if (!row || row.userId !== userId) {
    return { success: false, error: 'Notification not found', code: 'NOT_FOUND' }
  }
  await markNotificationRead(db, notificationId)
  return { success: true }
}

export async function handleMarkAllNotificationsRead(
  db: DB,
  userId: number
): Promise<Result> {
  await markAllNotificationsRead(db, userId)
  return { success: true }
}

export async function handleUpdateSubscription(
  db: DB,
  userId: number,
  subId: number,
  input: {
    name?: string
    price?: number
    nextPayment?: string
    inactive?: boolean
    refundPolicy?: 'payer_absorbs' | 'redistribute'
    tags?: SubscriptionTag[]
    logo?: string | null
    personalTags?: SubscriptionTag[]
  }
): Promise<Result> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))


  if (!sub) return { success: false, error: 'Subscription not found', code: 'NOT_FOUND' }
  // Three concentric permission scopes on this PATCH; each field lives in
  // exactly one. Unknown keys default to OWNER_ONLY so a new Zod field
  // can't silently open a hole.
  //   OWNER_ONLY   — name, price, nextPayment, inactive, refundPolicy
  //   PAYER_ALSO   — tags, logo (card-level metadata, owner or payer)
  //   MEMBER_ALSO  — personalTags (caller writes their own member row)
  const isOwner = sub.ownerId === userId
  const isPayer = sub.payerId === userId
  const PAYER_ALLOWED_KEYS = new Set(['tags', 'logo', 'personalTags'])
  const MEMBER_ALLOWED_KEYS = new Set(['personalTags'])
  if (!isOwner) {
    const keys = Object.keys(input)
    const allowed = isPayer ? PAYER_ALLOWED_KEYS : MEMBER_ALLOWED_KEYS
    const hasDisallowedKey = keys.some((k) => !allowed.has(k))
    if (hasDisallowedKey) {
      return {
        success: false,
        error: isPayer
          ? 'Only the owner can update this subscription'
          : 'Only the owner or payer can edit tags or logo',
        code: 'FORBIDDEN',
      }
    }
    if (!isPayer) {
      // Plain member path: verify an active membership row exists before
      // letting them write personalTags. Outsiders and former members
      // (leftAt set) fail here.
      const [memberRow] = await db
        .select({ userId: schema.subscriptionMembers.userId })
        .from(schema.subscriptionMembers)
        .where(
          and(
            eq(schema.subscriptionMembers.subscriptionId, subId),
            eq(schema.subscriptionMembers.userId, userId),
            isNull(schema.subscriptionMembers.leftAt)
          )
        )
      if (!memberRow) {
        return {
          success: false,
          error: 'Only active members can set personal tags',
          code: 'FORBIDDEN',
        }
      }
    }
  }

  // Price changes and metadata writes share a single transaction so a
  // crash between them can't leave the sub with the new price but the
  // old name (or vice versa).
  await db.transaction(async (tx) => {
    if (input.price !== undefined && input.price !== sub.price) {
      await changeSubscriptionPrice(tx, { subscriptionId: subId, newPrice: input.price })
    }

    const updates: Record<string, unknown> = {}
    if (input.name !== undefined) updates.name = input.name
    if (input.nextPayment !== undefined) updates.nextPayment = input.nextPayment
    if (input.inactive !== undefined) updates.inactive = input.inactive
    if (input.refundPolicy !== undefined) updates.refundPolicy = input.refundPolicy
    if (input.tags !== undefined) updates.tags = normalizeTags(input.tags)
    if (input.logo !== undefined) updates.logo = input.logo

    if (Object.keys(updates).length > 0) {
      await tx
        .update(schema.subscriptions)
        .set(updates)
        .where(eq(schema.subscriptions.id, subId))
    }

    if (input.personalTags !== undefined) {
      await tx
        .update(schema.subscriptionMembers)
        .set({ personalTags: normalizeTags(input.personalTags) })
        .where(
          and(
            eq(schema.subscriptionMembers.subscriptionId, subId),
            eq(schema.subscriptionMembers.userId, userId),
            isNull(schema.subscriptionMembers.leftAt)
          )
        )
    }
  })

  return { success: true }
}

export async function handleDeleteSubscription(
  db: DB,
  userId: number,
  subId: number
): Promise<Result> {
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))

  if (!sub) return { success: false, error: 'Subscription not found', code: 'NOT_FOUND' }
  if (sub.payerId !== userId) {
    return {
      success: false,
      error: 'Only the payer can delete this subscription',
      code: 'FORBIDDEN',
    }
  }

  // Hard delete. CASCADE on subscription_id wipes billing_records and
  // subscription_members atomically; notifications tied to this sub are
  // also cascaded per schema.  Paid bills are included — deletion
  // forgives all debts on this sub.
  await db
    .delete(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))

  return { success: true }
}

export async function handleMarkPaid(
  db: DB,
  userId: number,
  billId: number
): Promise<Result> {
  const [bill] = await db
    .select()
    .from(schema.billingRecords)
    .where(eq(schema.billingRecords.id, billId))
    

  // Return 404 in both cases — don't confirm existence of bills belonging
  // to other users.
  if (!bill || bill.userId !== userId) {
    return { success: false, error: 'Bill not found', code: 'NOT_FOUND' }
  }

  await markBillPaid(db, billId)
  return { success: true }
}

export async function handleGetDashboard(
  db: DB,
  userId: number
): Promise<{
  monthlyTotal: number
  pendingBills: Array<{
    id: number
    subscriptionName: string
    amount: number
    currency: string
  }>
  subscriptions: Array<{
    id: number
    name: string
    price: number
    currency: string
    memberCount: number
    logo: string | null
  }>
}> {
  const spendingData = await getMonthlySpendingData(db, userId)

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    

  const preferredCurrency = user?.preferredCurrency ?? 'CNY'

  // Fetch real FX rates for cross-currency subscriptions
  const rates: Record<string, number> = {}
  const foreignCurrencies = new Set(
    spendingData
      .filter((s) => s.currency !== preferredCurrency)
      .map((s) => s.currency)
  )

  await Promise.all(
    [...foreignCurrencies].map(async (cur) => {
      const rate = await getRate(cur, preferredCurrency)
      if (rate !== null) rates[`${cur}_${preferredCurrency}`] = rate
    })
  )

  const monthlyTotal = calculateMonthlySpending(
    spendingData,
    preferredCurrency,
    rates
  )

  const pendingBills = (await getPendingBills(db, userId)).map((b) => ({
    id: b.id,
    subscriptionName: b.subscriptionName,
    amount: b.amount,
    currency: b.currency,
  }))

  return {
    monthlyTotal,
    pendingBills,
    subscriptions: spendingData,
  }
}

// --- Circles (member preset templates; UI label: "Group") ---

export async function handleListCircles(
  db: DB,
  userId: number
): Promise<Result<CircleSummary[]>> {
  return { success: true, data: await listCirclesForOwner(db, userId) }
}

export async function handleCreateCircle(
  db: DB,
  userId: number,
  input: {
    name: string
    memberIds?: number[]
    defaultPayerId?: number | null
  }
): Promise<Result<{ id: number }>> {
  try {
    const result = await createCircle(db, {
      ownerUserId: userId,
      name: input.name,
      memberIds: input.memberIds,
      defaultPayerId: input.defaultPayerId,
    })
    return { success: true, data: result }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create circle',
    }
  }
}

export async function handleGetCircle(
  db: DB,
  userId: number,
  circleId: number
): Promise<Result<CircleSummary>> {
  const circle = await getCircle(db, circleId, userId)
  if (!circle) return { success: false, error: 'Not found', code: 'NOT_FOUND' }
  return { success: true, data: circle }
}

export async function handleUpdateCircle(
  db: DB,
  userId: number,
  circleId: number,
  patch: {
    name?: string
    memberIds?: number[]
    defaultPayerId?: number | null
  }
): Promise<Result> {
  try {
    const ok = await updateCircle(db, circleId, userId, patch)
    if (!ok) return { success: false, error: 'Not found', code: 'NOT_FOUND' }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update circle',
    }
  }
}

export async function handleDeleteCircle(
  db: DB,
  userId: number,
  circleId: number
): Promise<Result> {
  const ok = await deleteCircle(db, circleId, userId)
  if (!ok) return { success: false, error: 'Not found', code: 'NOT_FOUND' }
  return { success: true }
}

import { eq, and, inArray, or, desc, isNull } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import type { SubscriptionTag } from '@/db/schema'
import {
  createSubscription,
  getPendingBills,
  markBillPaid,
  getMonthlySpendingData,
} from './db-operations'
import { addMembersToSubscription, leaveSubscription } from './membership'
import { changeSubscriptionPrice } from './billing-ops'
import { runR1Cron } from './engine/cron'
import { recomputeMonth } from './engine/recompute'
import { normalizeTags, filterTagsForViewer } from './tags'
import { calculateMonthlySpending } from './billing'
import { advanceMonth, todayInAppTz } from './date-utils'
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
    /**
     * Immutable cycle anchor. Defaults to nextPayment when omitted —
     * the user only enters one date in the form, and it serves as both
     * "next charge" and "first charge" at creation time.
     */
    startDate?: string
    members?: number[]
    payerId?: number
    refundPolicy?: 'payer_absorbs' | 'redistribute'
    logo?: string | null
    url?: string
    notes?: string
    categoryId?: number
    tags?: SubscriptionTag[]
    /** Test-only override for "today". Defaults to todayInAppTz(). */
    today?: string
  }
): Promise<Result<{ id: number; name: string }>> {
  const invitees = (input.members ?? []).filter((id) => id !== userId)
  const payerId = input.payerId ?? userId
  const today = input.today ?? todayInAppTz()
  // startDate default heuristic: when the user inputs a nextPayment in
  // the past, treat it as "this sub has been running since then" and
  // backfill from there. When nextPayment is today/future, the user is
  // creating a brand-new sub — startDate is today and bills follow the
  // normal R2/R1 pattern. Callers can always pass startDate explicitly
  // to override.
  const startDate =
    input.startDate ?? (input.nextPayment < today ? input.nextPayment : today)

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
    startDate,
    ownerId: userId,
    payerId,
  })

  // Seed invitees as a SINGLE batch so every invitee's R2 bill is
  // computed against the same final member count — otherwise the first
  // invitee sees n=2, the second sees n=3, etc., and amounts diverge.
  // backfillFromStartDate=true: when startDate is in a past month, every
  // invitee gets one bill per missed month rather than just today's
  // prorate. No-op when startDate >= today.
  if (invitees.length > 0) {
    const rates = await fetchRatesForUsers(db, invitees, input.currency)
    await addMembersToSubscription(
      db,
      {
        subscriptionId: sub.id,
        invitees,
        addedBy: userId,
        addedAt: today,
        backfillFromStartDate: true,
      },
      rates
    )
  }

  // Advance nextPayment past today so the detail-page "next" label is
  // correct immediately after creation, not on the next cron pass.
  // Loops if startDate is months behind.
  await advanceNextPaymentPastToday(db, sub.id, today)

  return { success: true, data: sub }
}

async function advanceNextPaymentPastToday(
  db: DB,
  subId: number,
  today: string
): Promise<void> {
  const [row] = await db
    .select({ nextPayment: schema.subscriptions.nextPayment })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))
  if (!row) return

  let np = row.nextPayment
  while (np <= today) np = advanceMonth(np)
  if (np !== row.nextPayment) {
    await db
      .update(schema.subscriptions)
      .set({ nextPayment: np })
      .where(eq(schema.subscriptions.id, subId))
  }
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
  memberIds: number[],
  opts: { today?: string } = {}
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
  const today = opts.today ?? todayInAppTz()
  const errors: Array<{ userId: number; error: string }> = []

  // Batch path: addMembersToSubscription handles the whole group in one
  // transaction and generates each R2 bill against the FINAL member
  // count — so two invitees added together always owe the same amount.
  let perInvitee: Array<{ userId: number; status: 'added' | 'rejoin' | 'noop' }> = []
  try {
    const res = await addMembersToSubscription(
      db,
      { subscriptionId: subId, invitees, addedBy: actorId, addedAt: today },
      rates
    )
    perInvitee = res.perInvitee
  } catch (err) {
    // Whole-batch failure (e.g. missing FX). Report once under the first
    // invitee so the caller sees it; individual members are either all
    // inserted or all rolled back thanks to the single outer tx.
    const message = err instanceof Error ? err.message : String(err)
    errors.push({ userId: invitees[0], error: message })
  }

  let added = 0
  let reactivated = 0
  for (const r of perInvitee) {
    if (r.status === 'added') added++
    else if (r.status === 'rejoin') reactivated++
  }

  // Reconcile current month under the fair engine. Legacy R2 logic
  // already wrote per-member bills; this writes any signed adjustments
  // needed to align actual amounts with per-day fair allocation. No-op
  // when legacy already produced fair-matching values.
  if (added > 0 || reactivated > 0) {
    await reconcileCurrentMonth(db, subId, today, rates, `addMember:${today}`)
  }

  return { success: true, data: { added, reactivated, errors } }
}

/**
 * After a user-facing action (add/remove member, price change), call the
 * fair engine to reconcile the current month's bills. Idempotent on
 * `eventTag` — repeated calls in the same calendar second produce one
 * eventId and short-circuit on retry.
 */
async function reconcileCurrentMonth(
  db: DB,
  subscriptionId: number,
  today: string,
  rates: Record<string, number> | undefined,
  eventTag: string
): Promise<void> {
  const [year, month] = today.split('-').map(Number)
  await recomputeMonth(db, {
    subscriptionId,
    year,
    month,
    eventId: `${eventTag}:sub${subscriptionId}:${today}`,
    today,
    rates,
  })
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

  const today = todayInAppTz()
  try {
    await leaveSubscription(db, {
      subscriptionId: subId,
      userId: targetUserId,
      leftAt: today,
      actorId,
    })
    await reconcileCurrentMonth(db, subId, today, undefined, `leave:user${targetUserId}`)
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
 * Billing cron dispatcher (fair-engine). Runs every day; idempotent on
 * (sub, year, month) via `recomputeMonth`'s eventId guard. Folds prior-
 * month unpaid adjustments into the current month's R1 bill so members
 * see at most one payable line per cycle.
 */
export async function runBillingCron(
  db: DB,
  opts: { today?: string } = {}
): Promise<Result<{ monthlyBillsGenerated: number }>> {
  const today = opts.today ?? todayInAppTz()

  // Pre-load FX rates for every (sub.currency, member.preferredCurrency)
  // pair — the engine needs them when it inserts a fresh R1 bill in a
  // member's preferred currency.
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

  const out = await runR1Cron(db, { today, rates })
  return {
    success: true,
    data: { monthlyBillsGenerated: out.billsInserted },
  }
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
  currency?: string,
  /**
   * Optional bill-ID scope. Forwarded to `markPairSettled` so the
   * Settlement page's "Show upcoming" toggle (Phase 3) can settle only
   * the bills currently visible to the user. `[]` is an explicit no-op,
   * never a fall-back to "settle all".
   */
  billIds?: number[]
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
    billIds,
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
      ? await db
          .select({
            id: schema.subscriptions.id,
            name: schema.subscriptions.name,
            price: schema.subscriptions.price,
            currency: schema.subscriptions.currency,
            logo: schema.subscriptions.logo,
            payerId: schema.subscriptions.payerId,
          })
          .from(schema.subscriptions)
          .where(inArray(schema.subscriptions.id, mySubIds))
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
        // Viewer's actual out-of-pocket cost. Payer covers the whole
        // price and collects shares from everyone else, absorbing the
        // floor-division remainder; non-payer owes the split share.
        const perHead = Math.floor(sub.price / memberCount)
        const myShare =
          sub.payerId === userId
            ? sub.price - perHead * (memberCount - 1)
            : perHead
        sharedSubs.push({
          id: sub.id,
          name: sub.name,
          price: sub.price,
          currency: sub.currency,
          memberCount,
          myShare,
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

export type SubscriptionDetailMember = {
  userId: number
  displayName: string
  email?: string
  addedAt: string
  /** ISO date if the member has left, otherwise null. */
  leftAt?: string | null
  isPayer: boolean
  isOwner: boolean
  isSelf: boolean
  /**
   * 'active' = currently in the sub.
   * 'left_unsettled' = leftAt set, but they still have unpaid bills/adjustments.
   *   The UI should render these grayed with `outstandingAmount`.
   * Members who have fully cleared their account are filtered out entirely.
   */
  status: 'active' | 'left_unsettled'
  /**
   * Sum of unpaid `billing_records.amount` (signed, sub.currency cents).
   * Set only when status is 'left_unsettled'.
   */
  outstandingAmount?: number
  /**
   * Closed [addedAt, leftAt] intervals from earlier stints for a member
   * who left and was later re-added. Empty array when no rejoin history.
   * UI may render these as a "history" tooltip on the member chip.
   */
  previousIntervals: Array<{ addedAt: string; leftAt: string }>
}

export type SubscriptionDetail = {
  id: number
  name: string
  logo: string | null
  url: string | null
  notes: string | null
  price: number
  currency: string
  nextPayment: string
  startDate: string
  autoRenew: boolean
  categoryId: number | null
  ownerId: number
  payerId: number
  notify: boolean
  notifyDaysBefore: number
  tags: SubscriptionTag[]
  personalTags: SubscriptionTag[]
  /**
   * Sorted ascending by `effectiveFrom`. Always non-empty — newly created
   * subs are seeded with a single `{ price, effectiveFrom: startDate }` entry.
   */
  priceHistory: Array<{ price: number; effectiveFrom: string }>
  members: SubscriptionDetailMember[]
}

/**
 * Fetch a single subscription with members + tag visibility applied
 * for `userId`. Returns NOT_FOUND if the sub doesn't exist OR the
 * caller isn't an active member / owner / payer (we deliberately do
 * not distinguish "forbidden" from "missing" so we don't leak the
 * existence of subs the viewer shouldn't know about).
 *
 * `personalTags` is scoped to the caller's own `subscription_members`
 * row — no cross-user leakage.
 */
export async function handleGetSubscription(
  db: DB,
  userId: number,
  subId: number
): Promise<Result<SubscriptionDetail>> {
  const [sub] = await db
    .select({
      id: schema.subscriptions.id,
      name: schema.subscriptions.name,
      logo: schema.subscriptions.logo,
      url: schema.subscriptions.url,
      notes: schema.subscriptions.notes,
      price: schema.subscriptions.price,
      currency: schema.subscriptions.currency,
      nextPayment: schema.subscriptions.nextPayment,
      startDate: schema.subscriptions.startDate,
      autoRenew: schema.subscriptions.autoRenew,
      categoryId: schema.subscriptions.categoryId,
      ownerId: schema.subscriptions.ownerId,
      payerId: schema.subscriptions.payerId,
      notify: schema.subscriptions.notify,
      notifyDaysBefore: schema.subscriptions.notifyDaysBefore,
      refundPolicy: schema.subscriptions.refundPolicy,
      tags: schema.subscriptions.tags,
      priceHistory: schema.subscriptions.priceHistory,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, subId))

  if (!sub) return { success: false, error: 'Not found', code: 'NOT_FOUND' }

  // Authorization: owner, payer, or an active subscription_members row.
  let allowed = sub.ownerId === userId || sub.payerId === userId
  if (!allowed) {
    const [membership] = await db
      .select({ userId: schema.subscriptionMembers.userId })
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, subId),
          eq(schema.subscriptionMembers.userId, userId),
          isNull(schema.subscriptionMembers.leftAt)
        )
      )
    if (membership) allowed = true
  }
  if (!allowed) {
    return { success: false, error: 'Not found', code: 'NOT_FOUND' }
  }

  // Read ALL members (active + left). The lifecycle rule (left + cleared
  // account → hidden) is applied below after summing outstanding bills.
  const memberRows = await db
    .select({
      userId: schema.subscriptionMembers.userId,
      addedAt: schema.subscriptionMembers.addedAt,
      addedBy: schema.subscriptionMembers.addedBy,
      leftAt: schema.subscriptionMembers.leftAt,
      previousIntervals: schema.subscriptionMembers.previousIntervals,
    })
    .from(schema.subscriptionMembers)
    .where(eq(schema.subscriptionMembers.subscriptionId, subId))

  const memberIds = memberRows.map((m) => m.userId)
  const users =
    memberIds.length > 0
      ? await db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            displayName: schema.users.displayName,
            email: schema.users.email,
            showEmail: schema.users.showEmail,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, memberIds))
      : []
  const byId = new Map(users.map((u) => [u.id, u]))

  // Sum unpaid bills + adjustments per user for the "left_unsettled"
  // outstanding amount and the lifecycle filter.
  const unpaidBills = await db
    .select({
      userId: schema.billingRecords.userId,
      amount: schema.billingRecords.amount,
    })
    .from(schema.billingRecords)
    .where(
      and(
        eq(schema.billingRecords.subscriptionId, subId),
        eq(schema.billingRecords.isPaid, false)
      )
    )
  const unpaidByUser = new Map<number, number>()
  for (const b of unpaidBills) {
    unpaidByUser.set(b.userId, (unpaidByUser.get(b.userId) ?? 0) + b.amount)
  }

  const today = (await import('@/lib/date-utils')).todayInAppTz()

  const members: SubscriptionDetailMember[] = []
  for (const m of memberRows) {
    const u = byId.get(m.userId)
    const isPayer = m.userId === sub.payerId
    const isPastLeaver = m.leftAt !== null && m.leftAt <= today
    let status: 'active' | 'left_unsettled' = 'active'
    let outstandingAmount: number | undefined
    if (isPastLeaver) {
      const owed = unpaidByUser.get(m.userId) ?? 0
      if (owed === 0 && !isPayer) continue // filter out: cleared
      status = 'left_unsettled'
      outstandingAmount = owed
    }
    const row: SubscriptionDetailMember = {
      userId: m.userId,
      displayName: (u?.displayName?.trim() || u?.name) ?? `User #${m.userId}`,
      email: u?.showEmail ? u?.email : undefined,
      addedAt: m.addedAt,
      leftAt: m.leftAt,
      isPayer,
      isOwner: m.userId === sub.ownerId,
      isSelf: m.userId === userId,
      status,
      previousIntervals: Array.isArray(m.previousIntervals) ? m.previousIntervals : [],
    }
    if (outstandingAmount !== undefined) row.outstandingAmount = outstandingAmount
    members.push(row)
  }
  members.sort((a, b) => {
    if (a.addedAt !== b.addedAt) return a.addedAt.localeCompare(b.addedAt)
    return a.userId - b.userId
  })

  const viewerIsPrivileged = userId === sub.ownerId || userId === sub.payerId
  const tags = filterTagsForViewer(sub.tags, viewerIsPrivileged)

  // Fetch caller's personal tags — null-safe against former-stint rows
  // (the membership check above already guarantees an active row, but
  // the `.find` is still defensive).
  const [selfRow] = await db
    .select({ personalTags: schema.subscriptionMembers.personalTags })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, subId),
        eq(schema.subscriptionMembers.userId, userId),
        isNull(schema.subscriptionMembers.leftAt)
      )
    )
  const personalTags = selfRow?.personalTags ?? []

  return {
    success: true,
    data: { ...sub, tags, personalTags, members },
  }
}

export async function handleUpdateSubscription(
  db: DB,
  userId: number,
  subId: number,
  input: {
    name?: string
    price?: number
    /** ISO YYYY-MM-DD; required when price changes — UI defaults to sub.nextPayment. */
    effectiveFrom?: string
    nextPayment?: string
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
  //   OWNER_ONLY   — name, price, nextPayment, refundPolicy
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
  let priceChanged = false
  try {
    await db.transaction(async (tx) => {
      if (input.price !== undefined && input.price !== sub.price) {
        await changeSubscriptionPrice(tx, {
          subscriptionId: subId,
          newPrice: input.price,
          effectiveFrom: input.effectiveFrom,
        })
        priceChanged = true
      }

      const updates: Record<string, unknown> = {}
      if (input.name !== undefined) updates.name = input.name
      if (input.nextPayment !== undefined) updates.nextPayment = input.nextPayment
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
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Update failed',
      code: 'BAD_REQUEST',
    }
  }

  if (priceChanged) {
    await reconcileCurrentMonth(
      db,
      subId,
      todayInAppTz(),
      undefined,
      'priceChange'
    )
  }

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
  monthlyTotalCurrency: string
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
    monthlyTotalCurrency: preferredCurrency,
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

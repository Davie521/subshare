import { eq, and, isNull, desc, inArray, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import { getNormalizedSettlement, getAgreedCurrencyMap } from './settlement'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export type NotificationType =
  | 'added_to_sub'
  | 'price_changed'
  | 'payer_changed'
  | 'removed_from_sub'
  | 'sub_deleted'
  | 'settlement_due'

export interface SettlementDuePayload {
  counterpartyUserId: number
  counterpartyName: string
  /** Currency the netted amount is expressed in (viewer's preferredCurrency). */
  currency: string
  /** Net amount in `currency`. Positive only — direction encodes the sign. */
  amount: number
  billCount: number
  oldestBillingDate: string
  /** 'outgoing' = viewer owes counterparty; 'incoming' = counterparty owes viewer. */
  direction: 'outgoing' | 'incoming'
}

export interface NotificationRecord<P = unknown> {
  id: number
  userId: number
  type: string
  subscriptionId: number | null
  payload: P
  createdAt: string
  readAt: string | null
}

export async function insertNotification(
  db: DB,
  input: {
    userId: number
    type: string
    subscriptionId?: number | null
    payload: unknown
  }
): Promise<number> {
  const [row] = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      type: input.type,
      subscriptionId: input.subscriptionId ?? null,
      payload: JSON.stringify(input.payload ?? {}),
      createdAt: new Date().toISOString(),
    })
    .returning({ id: schema.notifications.id })
  return row.id
}

export async function listNotifications<P = unknown>(
  db: DB,
  userId: number,
  limit = 50
): Promise<NotificationRecord<P>[]> {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(
      desc(schema.notifications.createdAt),
      desc(schema.notifications.id)
    )
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    type: r.type,
    subscriptionId: r.subscriptionId,
    payload: safeParseJson<P>(r.payload),
    createdAt: r.createdAt,
    readAt: r.readAt,
  }))
}

export async function markNotificationRead(
  db: DB,
  id: number
): Promise<void> {
  await db
    .update(schema.notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.notifications.id, id),
        isNull(schema.notifications.readAt)
      )
    )
}

export async function markAllNotificationsRead(
  db: DB,
  userId: number
): Promise<void> {
  await db
    .update(schema.notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt)
      )
    )
}

export async function countUnreadNotifications(
  db: DB,
  userId: number
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt)
      )
    )
  return Number(row?.count ?? 0)
}

function safeParseJson<P>(s: string): P {
  try {
    return JSON.parse(s) as P
  } catch {
    return {} as P
  }
}

/**
 * Reconciles `settlement_due` notifications for `userId` against current
 * unpaid bill state. **One notification per counterparty** — netted across
 * all currencies into the viewer's preferredCurrency. Idempotent.
 *
 * - Inserts notifications for counterparties with no existing notification.
 * - Updates payload when amount / billCount / direction changes.
 *   - Preserves `readAt` unless billCount grew (new bill arrived).
 * - Deletes notifications whose net is now zero (everything settled).
 */
export async function syncSettlementDueNotifications(
  db: DB,
  userId: number
): Promise<void> {
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

  // One desired notification per counterparty (skip if net is zero).
  type Desired = { key: number; payload: SettlementDuePayload }
  const desired: Desired[] = []
  for (const r of rows) {
    if (r.netAmount === 0) continue
    const direction: 'outgoing' | 'incoming' =
      r.netAmount < 0 ? 'outgoing' : 'incoming'
    const oldestBillingDate = r.bills
      .map((b) => b.billingDate)
      .slice()
      .sort()[0] ?? ''
    desired.push({
      key: r.counterpartyUserId,
      payload: {
        counterpartyUserId: r.counterpartyUserId,
        counterpartyName: '',
        currency: r.displayCurrency,
        amount: Math.abs(r.netAmount),
        billCount: r.billCount,
        oldestBillingDate,
        direction,
      },
    })
  }

  const counterpartyIds = Array.from(
    new Set(desired.map((d) => d.payload.counterpartyUserId))
  )
  if (counterpartyIds.length > 0) {
    const users = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, counterpartyIds))
    const nameById = new Map(
      users.map((u) => [u.id, u.displayName?.trim() || u.name || 'Unknown'])
    )
    for (const d of desired) {
      d.payload.counterpartyName =
        nameById.get(d.payload.counterpartyUserId) ?? 'Unknown'
    }
  }

  const existing = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.type, 'settlement_due')
      )
    )

  const existingByKey = new Map<number, (typeof existing)[number]>()
  for (const n of existing) {
    const p = safeParseJson<Partial<SettlementDuePayload>>(n.payload)
    if (typeof p?.counterpartyUserId === 'number') {
      existingByKey.set(p.counterpartyUserId, n)
    }
  }

  const desiredByKey = new Map<number, SettlementDuePayload>()
  for (const d of desired) desiredByKey.set(d.key, d.payload)

  for (const [key, payload] of desiredByKey) {
    const ex = existingByKey.get(key)
    if (!ex) {
      await db.insert(schema.notifications).values({
        userId,
        type: 'settlement_due',
        subscriptionId: null,
        payload: JSON.stringify(payload),
        createdAt: new Date().toISOString(),
      })
    } else {
      const oldPayload = safeParseJson<SettlementDuePayload>(ex.payload)
      const desiredJson = JSON.stringify(payload)
      if (JSON.stringify(oldPayload) !== desiredJson) {
        const billCountGrew =
          payload.billCount > (oldPayload?.billCount ?? 0)
        await db
          .update(schema.notifications)
          .set({
            payload: desiredJson,
            ...(billCountGrew
              ? { readAt: null, createdAt: new Date().toISOString() }
              : {}),
          })
          .where(eq(schema.notifications.id, ex.id))
      }
    }
  }

  for (const [key, ex] of existingByKey) {
    if (!desiredByKey.has(key)) {
      await db
        .delete(schema.notifications)
        .where(eq(schema.notifications.id, ex.id))
    }
  }
}

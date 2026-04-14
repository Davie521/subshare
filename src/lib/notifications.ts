import { eq, and, isNull, desc } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'

type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export type NotificationType =
  | 'added_to_sub'
  | 'price_changed'
  | 'payer_changed'
  | 'removed_from_sub'
  | 'sub_deleted'

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
  const rows = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt)
      )
    )
  return rows.length
}

function safeParseJson<P>(s: string): P {
  try {
    return JSON.parse(s) as P
  } catch {
    return {} as P
  }
}

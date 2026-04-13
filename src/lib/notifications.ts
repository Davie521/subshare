import { eq, and, isNull, desc } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'

type DB = BetterSQLite3Database<typeof schema>

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

export function insertNotification(
  db: DB,
  input: {
    userId: number
    type: string
    subscriptionId?: number | null
    payload: unknown
  }
): number {
  const row = db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      type: input.type,
      subscriptionId: input.subscriptionId ?? null,
      payload: JSON.stringify(input.payload ?? {}),
      createdAt: new Date().toISOString(),
    })
    .returning({ id: schema.notifications.id })
    .get()
  return row.id
}

export function listNotifications<P = unknown>(
  db: DB,
  userId: number,
  limit = 50
): NotificationRecord<P>[] {
  const rows = db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
    .limit(limit)
    .all()

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

export function markNotificationRead(db: DB, id: number): void {
  db.update(schema.notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.notifications.id, id),
        isNull(schema.notifications.readAt)
      )
    )
    .run()
}

export function markAllNotificationsRead(db: DB, userId: number): void {
  db.update(schema.notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt)
      )
    )
    .run()
}

export function countUnreadNotifications(db: DB, userId: number): number {
  const rows = db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt)
      )
    )
    .all()
  return rows.length
}

function safeParseJson<P>(s: string): P {
  try {
    return JSON.parse(s) as P
  } catch {
    return {} as P
  }
}

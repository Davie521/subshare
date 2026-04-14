import { eq, and, inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '@/db/schema'

type DB = BetterSQLite3Database<typeof schema>

export interface CircleSummary {
  id: number
  name: string
  ownerUserId: number
  defaultPayerId: number | null
  memberIds: number[]
  createdAt: string
}

export function createCircle(
  db: DB,
  input: {
    ownerUserId: number
    name: string
    memberIds?: number[]
    defaultPayerId?: number | null
  }
): { id: number } {
  const name = input.name.trim()
  if (!name) throw new Error('Circle name cannot be empty')

  const row = db
    .insert(schema.circles)
    .values({
      name,
      ownerUserId: input.ownerUserId,
      defaultPayerId: input.defaultPayerId ?? null,
    })
    .returning({ id: schema.circles.id })
    .get()

  // Owner is always a member; extra ids merged and deduped.
  const memberSet = new Set<number>([input.ownerUserId, ...(input.memberIds ?? [])])
  for (const userId of memberSet) {
    db.insert(schema.circleMembers)
      .values({ circleId: row.id, userId })
      .onConflictDoNothing()
      .run()
  }

  return { id: row.id }
}

export function listCirclesForOwner(
  db: DB,
  ownerUserId: number
): CircleSummary[] {
  const circles = db
    .select()
    .from(schema.circles)
    .where(eq(schema.circles.ownerUserId, ownerUserId))
    .all()

  if (circles.length === 0) return []

  const ids = circles.map((c) => c.id)
  const memberRows = db
    .select()
    .from(schema.circleMembers)
    .where(inArray(schema.circleMembers.circleId, ids))
    .all()

  const byCircle = new Map<number, number[]>()
  for (const m of memberRows) {
    const list = byCircle.get(m.circleId) ?? []
    list.push(m.userId)
    byCircle.set(m.circleId, list)
  }

  return circles.map((c) => ({
    id: c.id,
    name: c.name,
    ownerUserId: c.ownerUserId,
    defaultPayerId: c.defaultPayerId,
    memberIds: byCircle.get(c.id) ?? [],
    createdAt: c.createdAt,
  }))
}

export function getCircle(
  db: DB,
  circleId: number,
  viewerId: number
): CircleSummary | null {
  const row = db
    .select()
    .from(schema.circles)
    .where(
      and(
        eq(schema.circles.id, circleId),
        eq(schema.circles.ownerUserId, viewerId)
      )
    )
    .get()
  if (!row) return null
  const memberIds = db
    .select({ userId: schema.circleMembers.userId })
    .from(schema.circleMembers)
    .where(eq(schema.circleMembers.circleId, circleId))
    .all()
    .map((r) => r.userId)
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.ownerUserId,
    defaultPayerId: row.defaultPayerId,
    memberIds,
    createdAt: row.createdAt,
  }
}

export function updateCircle(
  db: DB,
  circleId: number,
  ownerUserId: number,
  patch: {
    name?: string
    memberIds?: number[]
    defaultPayerId?: number | null
  }
): boolean {
  const row = db
    .select()
    .from(schema.circles)
    .where(
      and(
        eq(schema.circles.id, circleId),
        eq(schema.circles.ownerUserId, ownerUserId)
      )
    )
    .get()
  if (!row) return false

  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim()
    if (!trimmed) throw new Error('Circle name cannot be empty')
    updates.name = trimmed
  }
  if (patch.defaultPayerId !== undefined) {
    updates.defaultPayerId = patch.defaultPayerId
  }
  if (Object.keys(updates).length > 0) {
    db.update(schema.circles)
      .set(updates)
      .where(eq(schema.circles.id, circleId))
      .run()
  }

  if (patch.memberIds !== undefined) {
    const desired = new Set<number>([ownerUserId, ...patch.memberIds])
    // Replace full membership set.
    db.delete(schema.circleMembers)
      .where(eq(schema.circleMembers.circleId, circleId))
      .run()
    for (const userId of desired) {
      db.insert(schema.circleMembers)
        .values({ circleId, userId })
        .onConflictDoNothing()
        .run()
    }
  }

  return true
}

export function deleteCircle(
  db: DB,
  circleId: number,
  ownerUserId: number
): boolean {
  const result = db
    .delete(schema.circles)
    .where(
      and(
        eq(schema.circles.id, circleId),
        eq(schema.circles.ownerUserId, ownerUserId)
      )
    )
    .run()
  return result.changes > 0
}

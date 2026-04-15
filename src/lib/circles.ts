import { eq, and, inArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PgDatabase<PgQueryResultHKT, typeof schema, any>

export interface CircleSummary {
  id: number
  name: string
  ownerUserId: number
  defaultPayerId: number | null
  memberIds: number[]
  createdAt: string
}

export async function createCircle(
  db: DB,
  input: {
    ownerUserId: number
    name: string
    memberIds?: number[]
    defaultPayerId?: number | null
  }
): Promise<{ id: number }> {
  const name = input.name.trim()
  if (!name) throw new Error('Circle name cannot be empty')

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.circles)
      .values({
        name,
        ownerUserId: input.ownerUserId,
        defaultPayerId: input.defaultPayerId ?? null,
      })
      .returning({ id: schema.circles.id })

    const memberSet = new Set<number>([input.ownerUserId, ...(input.memberIds ?? [])])
    for (const userId of memberSet) {
      await tx.insert(schema.circleMembers)
        .values({ circleId: row.id, userId })
        .onConflictDoNothing()
    }

    return { id: row.id }
  })
}

export async function listCirclesForOwner(
  db: DB,
  ownerUserId: number
): Promise<CircleSummary[]> {
  const circles = await db
    .select()
    .from(schema.circles)
    .where(eq(schema.circles.ownerUserId, ownerUserId))
    

  if (circles.length === 0) return []

  const ids = circles.map((c) => c.id)
  const memberRows = await db
    .select()
    .from(schema.circleMembers)
    .where(inArray(schema.circleMembers.circleId, ids))
    

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

export async function getCircle(
  db: DB,
  circleId: number,
  viewerId: number
): Promise<CircleSummary | null> {
  const [row] = await db
    .select()
    .from(schema.circles)
    .where(
      and(
        eq(schema.circles.id, circleId),
        eq(schema.circles.ownerUserId, viewerId)
      )
    )
    
  if (!row) return null
  const memberIds = (await db
    .select({ userId: schema.circleMembers.userId })
    .from(schema.circleMembers)
    .where(eq(schema.circleMembers.circleId, circleId))
  ).map((r) => r.userId)
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.ownerUserId,
    defaultPayerId: row.defaultPayerId,
    memberIds,
    createdAt: row.createdAt,
  }
}

export async function updateCircle(
  db: DB,
  circleId: number,
  ownerUserId: number,
  patch: {
    name?: string
    memberIds?: number[]
    defaultPayerId?: number | null
  }
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.circles)
      .where(
        and(
          eq(schema.circles.id, circleId),
          eq(schema.circles.ownerUserId, ownerUserId)
        )
      )
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
      await tx.update(schema.circles)
        .set(updates)
        .where(eq(schema.circles.id, circleId))
    }

    if (patch.memberIds !== undefined) {
      const desired = new Set<number>([ownerUserId, ...patch.memberIds])
      await tx.delete(schema.circleMembers)
        .where(eq(schema.circleMembers.circleId, circleId))
      for (const userId of desired) {
        await tx.insert(schema.circleMembers)
          .values({ circleId, userId })
          .onConflictDoNothing()
      }
    }

    return true
  })
}

export async function deleteCircle(
  db: DB,
  circleId: number,
  ownerUserId: number
): Promise<boolean> {
  const result = await db
    .delete(schema.circles)
    .where(
      and(
        eq(schema.circles.id, circleId),
        eq(schema.circles.ownerUserId, ownerUserId)
      )
    )
    .returning({ id: schema.circles.id })

  return result.length > 0
}

import { NextRequest, NextResponse } from 'next/server'
import { eq, inArray } from 'drizzle-orm'
import { requireAuth } from '@/lib/api-utils'
import { handleCreateGroup } from '@/lib/api-handlers'
import { createGroupSchema } from '@/lib/validators'
import * as schema from '@/db/schema'

export async function GET() {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const memberships = await db
    .select({ groupId: schema.groupMembers.groupId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.userId, userId))

  const groupIds = memberships.map((m) => m.groupId)
  if (groupIds.length === 0) return NextResponse.json([])

  // Fix N+1: single query
  const groups = await db
    .select()
    .from(schema.groups)
    .where(inArray(schema.groups.id, groupIds))

  return NextResponse.json(groups)
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const parsed = createGroupSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Name required (max 100 chars)' }, { status: 400 })
  }

  const result = await handleCreateGroup(db, userId, parsed.data)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json(result.data, { status: 201 })
}

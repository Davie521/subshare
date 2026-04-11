import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/api-utils'
import { handleCreateGroup } from '@/lib/api-handlers'
import * as schema from '@/db/schema'

export async function GET() {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const memberships = db
    .select({ groupId: schema.groupMembers.groupId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.userId, userId))
    .all()

  const groups = memberships.map((m) => {
    const group = db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, m.groupId))
      .get()
    return group
  }).filter(Boolean)

  return NextResponse.json(groups)
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const { name } = await req.json()
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const result = handleCreateGroup(db, userId, { name })
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json(result.data, { status: 201 })
}

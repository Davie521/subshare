import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, parseId } from '@/lib/api-utils'
import { handleAddMembers } from '@/lib/api-handlers'

const addMembersSchema = z.object({
  members: z.array(z.number().int().positive()).min(1).max(50),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const subId = parseId((await params).id)
  if (subId === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const parsed = addMembersSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const result = await handleAddMembers(db, userId, subId, parsed.data.members)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json(result.data)
}

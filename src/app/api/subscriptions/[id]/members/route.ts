import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  requireAuth,
  parseId,
  readJson,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
import { handleAddMembers } from '@/lib/api-handlers'

const addMembersSchema = z.object({
  members: z.array(z.number().int().positive()).min(1).max(50),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('subscriptions.members.add', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'members-add', 30, 60_000)
    if (limited) return limited

    const subId = parseId((await params).id)
    if (subId === null) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const body = await readJson(req)
    if (body instanceof NextResponse) return body

    const parsed = addMembersSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const result = await handleAddMembers(db, userId, subId, parsed.data.members)
    return resultResponse(result)
  })
}

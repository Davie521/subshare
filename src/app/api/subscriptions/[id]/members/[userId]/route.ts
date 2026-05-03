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
import { handleRemoveMember } from '@/lib/api-handlers'
import { editMemberAddedAt } from '@/lib/engine/edit-added-at'
import { todayInAppTz } from '@/lib/date-utils'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  return guard('subscriptions.members.remove', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId: actorId, db } = auth

    const limited = rateLimitUser(actorId, 'members-remove', 30, 60_000)
    if (limited) return limited

    const p = await params
    const subId = parseId(p.id)
    const targetUserId = parseId(p.userId)
    if (subId === null || targetUserId === null) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const result = await handleRemoveMember(db, actorId, subId, targetUserId)
    return resultResponse(result)
  })
}

const editAddedAtSchema = z.object({
  newAddedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'newAddedAt must be ISO YYYY-MM-DD'),
})

/**
 * Owner-only retroactive edit of a member's `addedAt`. Triggers the
 * fair-engine recompute over every affected month (back to 6-month
 * horizon). Returns the affected month range so the UI can show a
 * "this updated N months of bills" confirmation.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  return guard('subscriptions.members.edit-added-at', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId: actorId, db } = auth

    const limited = rateLimitUser(actorId, 'members-edit-added-at', 30, 60_000)
    if (limited) return limited

    const p = await params
    const subId = parseId(p.id)
    const targetUserId = parseId(p.userId)
    if (subId === null || targetUserId === null) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const body = await readJson(req)
    if (body instanceof NextResponse) return body
    const parsed = editAddedAtSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    try {
      const result = await editMemberAddedAt(db, {
        subscriptionId: subId,
        targetUserId,
        actorUserId: actorId,
        newAddedAt: parsed.data.newAddedAt,
        today: todayInAppTz(),
      })
      return NextResponse.json({ success: true, data: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'edit failed'
      // Permission-denied → 403; other validation errors → 400.
      const status = /permission|owner only/i.test(message) ? 403 : 400
      return NextResponse.json({ error: message }, { status })
    }
  })
}

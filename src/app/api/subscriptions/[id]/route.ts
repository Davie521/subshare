import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, parseId } from '@/lib/api-utils'
import { handleUpdateSubscription, handleDeleteSubscription } from '@/lib/api-handlers'
import { updateSubscriptionSchema } from '@/lib/validators'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import * as schema from '@/db/schema'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const numId = parseId(id)
  if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, numId))
    .get()

  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Authorization: owner, payer, or active subscription_members
  let allowed = sub.ownerId === userId || sub.payerId === userId
  if (!allowed) {
    const subMembership = db
      .select()
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, numId),
          eq(schema.subscriptionMembers.userId, userId)
        )
      )
      .get()
    if (subMembership) allowed = true
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Enriched members list (active only).
  const memberRows = db
    .select({
      userId: schema.subscriptionMembers.userId,
      addedAt: schema.subscriptionMembers.addedAt,
      addedBy: schema.subscriptionMembers.addedBy,
      leftAt: schema.subscriptionMembers.leftAt,
    })
    .from(schema.subscriptionMembers)
    .where(
      and(
        eq(schema.subscriptionMembers.subscriptionId, numId),
        isNull(schema.subscriptionMembers.leftAt)
      )
    )
    .all()

  const memberIds = memberRows.map((m) => m.userId)
  const users =
    memberIds.length > 0
      ? db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            displayName: schema.users.displayName,
            email: schema.users.email,
            showEmail: schema.users.showEmail,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, memberIds))
          .all()
      : []
  const byId = new Map(users.map((u) => [u.id, u]))

  const members = memberRows.map((m) => {
    const u = byId.get(m.userId)
    return {
      userId: m.userId,
      displayName: (u?.displayName?.trim() || u?.name) ?? `User #${m.userId}`,
      email: u?.showEmail === 1 ? u?.email : undefined,
      addedAt: m.addedAt,
      isPayer: m.userId === sub.payerId,
      isOwner: m.userId === sub.ownerId,
      isSelf: m.userId === userId,
    }
  })

  return NextResponse.json({ ...sub, members })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const numId = parseId(id)
  if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const parsed = updateSubscriptionSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const result = handleUpdateSubscription(db, userId, numId, parsed.data)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const numId = parseId(id)
  if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

  const result = handleDeleteSubscription(db, userId, numId)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}

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

  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, numId))

  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Authorization: owner, payer, or active subscription_members
  let allowed = sub.ownerId === userId || sub.payerId === userId
  if (!allowed) {
    const [subMembership] = await db
      .select()
      .from(schema.subscriptionMembers)
      .where(
        and(
          eq(schema.subscriptionMembers.subscriptionId, numId),
          eq(schema.subscriptionMembers.userId, userId)
        )
      )
    if (subMembership) allowed = true
  }
<<<<<<< HEAD
  if (!allowed && sub.groupId) {
    const [legacy] = await db
      .select()
      .from(schema.groupMembers)
      .where(
        and(
          eq(schema.groupMembers.groupId, sub.groupId),
          eq(schema.groupMembers.userId, userId)
        )
      )
    if (legacy) allowed = true
  }
||||||| edd84f2
  if (!allowed && sub.groupId) {
    const legacy = db
      .select()
      .from(schema.groupMembers)
      .where(
        and(
          eq(schema.groupMembers.groupId, sub.groupId),
          eq(schema.groupMembers.userId, userId)
        )
      )
      .get()
    if (legacy) allowed = true
  }
=======
>>>>>>> origin/main
  if (!allowed) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Enriched members list (active only).
  const memberRows = await db
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

  const memberIds = memberRows.map((m) => m.userId)
  const users =
    memberIds.length > 0
      ? await db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            displayName: schema.users.displayName,
            email: schema.users.email,
            showEmail: schema.users.showEmail,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, memberIds))
      : []
  const byId = new Map(users.map((u) => [u.id, u]))

  const members = memberRows.map((m) => {
    const u = byId.get(m.userId)
    return {
      userId: m.userId,
      displayName: (u?.displayName?.trim() || u?.name) ?? `User #${m.userId}`,
      email: u?.showEmail ? u?.email : undefined,
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

  const result = await handleUpdateSubscription(db, userId, numId, parsed.data)
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

  const result = await handleDeleteSubscription(db, userId, numId)
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}

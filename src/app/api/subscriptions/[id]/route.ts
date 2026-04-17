import { NextRequest, NextResponse } from 'next/server'
import {
  requireAuth,
  parseId,
  readJson,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
import { handleUpdateSubscription, handleDeleteSubscription } from '@/lib/api-handlers'
import { updateSubscriptionSchema } from '@/lib/validators'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { filterTagsForViewer } from '@/lib/tags'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('subscriptions.get', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth
    const { id } = await params
    const numId = parseId(id)
    if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const [sub] = await db
      .select({
        id: schema.subscriptions.id,
        name: schema.subscriptions.name,
        logo: schema.subscriptions.logo,
        url: schema.subscriptions.url,
        notes: schema.subscriptions.notes,
        price: schema.subscriptions.price,
        currency: schema.subscriptions.currency,
        nextPayment: schema.subscriptions.nextPayment,
        startDate: schema.subscriptions.startDate,
        autoRenew: schema.subscriptions.autoRenew,
        inactive: schema.subscriptions.inactive,
        categoryId: schema.subscriptions.categoryId,
        ownerId: schema.subscriptions.ownerId,
        payerId: schema.subscriptions.payerId,
        notify: schema.subscriptions.notify,
        notifyDaysBefore: schema.subscriptions.notifyDaysBefore,
        tags: schema.subscriptions.tags,
      })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, numId))

    if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Authorization: owner, payer, or active subscription_members.
    let allowed = sub.ownerId === userId || sub.payerId === userId
    if (!allowed) {
      const [subMembership] = await db
        .select()
        .from(schema.subscriptionMembers)
        .where(
          and(
            eq(schema.subscriptionMembers.subscriptionId, numId),
            eq(schema.subscriptionMembers.userId, userId),
            isNull(schema.subscriptionMembers.leftAt)
          )
        )
      if (subMembership) allowed = true
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

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

    const tags = filterTagsForViewer(sub.tags, userId, sub.payerId)
    return NextResponse.json({ ...sub, tags, members })
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('subscriptions.update', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'sub-update', 60, 60_000)
    if (limited) return limited

    const { id } = await params
    const numId = parseId(id)
    if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const body = await readJson(req)
    if (body instanceof NextResponse) return body

    const parsed = updateSubscriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const result = await handleUpdateSubscription(db, userId, numId, parsed.data)
    return resultResponse(result)
  })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return guard('subscriptions.delete', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'sub-delete', 30, 60_000)
    if (limited) return limited

    const { id } = await params
    const numId = parseId(id)
    if (!numId) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })

    const result = await handleDeleteSubscription(db, userId, numId)
    return resultResponse(result)
  })
}

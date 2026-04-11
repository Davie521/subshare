import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { handleUpdateSubscription, handleDeleteSubscription } from '@/lib/api-handlers'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { db } = auth
  const { id } = await params

  const sub = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.id, parseInt(id)))
    .get()

  if (!sub) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(sub)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth
  const { id } = await params
  const body = await req.json()

  const result = handleUpdateSubscription(db, userId, parseInt(id), body)
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

  const result = handleDeleteSubscription(db, userId, parseInt(id))
  if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true })
}

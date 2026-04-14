import { NextResponse } from 'next/server'
import { requireAuth, parseId } from '@/lib/api-utils'
import { handleMarkNotificationRead } from '@/lib/api-handlers'

export async function PUT(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const id = parseId((await params).id)
  if (id === null) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const result = handleMarkNotificationRead(db, userId, id)
  if (!result.success) {
    const isAuth = /not your/i.test(result.error)
    return NextResponse.json(
      { error: result.error },
      { status: isAuth ? 403 : 404 }
    )
  }
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, parseId } from '@/lib/api-utils'
import { handleTransferPayer } from '@/lib/api-handlers'

const schema = z.object({
  newPayerId: z.number().int().positive(),
})

export async function PUT(
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

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const result = await handleTransferPayer(db, userId, subId, parsed.data.newPayerId)
  if (!result.success) {
    const isPermission = /owner|payer|permission/i.test(result.error)
    return NextResponse.json(
      { error: result.error },
      { status: isPermission ? 403 : 400 }
    )
  }
  return NextResponse.json({ ok: true })
}

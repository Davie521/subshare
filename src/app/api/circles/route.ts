import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-utils'
import { handleListCircles, handleCreateCircle } from '@/lib/api-handlers'
import { createCircleSchema } from '@/lib/validators'

export async function GET() {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const result = await handleListCircles(db, userId)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json(result.data)
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const { userId, db } = auth

  const parsed = createCircleSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const result = await handleCreateCircle(db, userId, parsed.data)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json(result.data)
}

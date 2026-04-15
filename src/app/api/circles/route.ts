import { NextRequest, NextResponse } from 'next/server'
import {
  requireAuth,
  readJson,
  resultResponse,
  rateLimitUser,
  guard,
} from '@/lib/api-utils'
import { handleListCircles, handleCreateCircle } from '@/lib/api-handlers'
import { createCircleSchema } from '@/lib/validators'

export async function GET() {
  return guard('circles.list', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const result = await handleListCircles(db, userId)
    return resultResponse(result)
  })
}

export async function POST(req: NextRequest) {
  return guard('circles.create', async () => {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth
    const { userId, db } = auth

    const limited = rateLimitUser(userId, 'circle-create', 30, 60_000)
    if (limited) return limited

    const body = await readJson(req)
    if (body instanceof NextResponse) return body

    const parsed = createCircleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const result = await handleCreateCircle(db, userId, parsed.data)
    return resultResponse(result, 201)
  })
}

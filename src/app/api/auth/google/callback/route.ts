import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import * as schema from '@/db/schema'
import { setSession } from '@/lib/session'
import { getGoogleProvider, fetchGoogleUserInfo } from '@/lib/oauth-google'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIp } from '@/lib/client-ip'
import { resolveRequestUrl } from '@/lib/request-url'

export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  if (!checkRateLimit(`oauth-callback:${ip}`, 30, 60_000)) {
    return NextResponse.redirect(resolveRequestUrl(req, '/login?error=rate_limit'))
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(resolveRequestUrl(req, '/login?error=oauth_denied'))
  }

  if (!code || !state) {
    return NextResponse.redirect(resolveRequestUrl(req, '/login?error=invalid_request'))
  }

  // Verify state (CSRF protection)
  const cookieStore = await cookies()
  const storedState = cookieStore.get('oauth_state')?.value
  const storedCodeVerifier = cookieStore.get('oauth_code_verifier')?.value

  // Clean up OAuth cookies
  cookieStore.delete('oauth_state')
  cookieStore.delete('oauth_code_verifier')

  if (!storedState || state !== storedState) {
    return NextResponse.redirect(resolveRequestUrl(req, '/login?error=state_mismatch'))
  }

  if (!storedCodeVerifier) {
    return NextResponse.redirect(resolveRequestUrl(req, '/login?error=missing_verifier'))
  }

  try {
    const google = getGoogleProvider()
    const tokens = await google.validateAuthorizationCode(code, storedCodeVerifier)
    const accessToken = tokens.accessToken()

    const profile = await fetchGoogleUserInfo(accessToken)

    if (!profile.email_verified) {
      return NextResponse.redirect(
        resolveRequestUrl(req, '/login?error=email_not_verified')
      )
    }

    const db = await getDb()

    // 1. Try to find by google_id (returning user)
    let [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.googleId, profile.sub))

    if (!user) {
      // 2. Try to link by email (Q7=a: auto-link)
      const [byEmail] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, profile.email))

      if (byEmail) {
        // Link existing account to Google
        await db
          .update(schema.users)
          .set({
            googleId: profile.sub,
            avatar: profile.picture ?? null,
          })
          .where(eq(schema.users.id, byEmail.id))
        user = byEmail
      } else {
        // 3. Create new user
        const [newUser] = await db
          .insert(schema.users)
          .values({
            name: profile.name,
            email: profile.email,
            googleId: profile.sub,
            avatar: profile.picture ?? null,
          })
          .returning()
        user = { id: newUser.id }
      }
    } else {
      // Update avatar on each login
      await db
        .update(schema.users)
        .set({ avatar: profile.picture ?? null })
        .where(eq(schema.users.id, user.id))
    }

    await setSession(user.id)
    return NextResponse.redirect(resolveRequestUrl(req, '/dashboard'))
  } catch {
    return NextResponse.redirect(resolveRequestUrl(req, '/login?error=oauth_failed'))
  }
}

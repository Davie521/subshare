import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  getGoogleProvider,
  generateState,
  generateCodeVerifier,
} from '@/lib/oauth-google'

export async function GET(req: NextRequest) {
  const google = getGoogleProvider()
  const state = generateState()
  const codeVerifier = generateCodeVerifier()

  const url = google.createAuthorizationURL(state, codeVerifier, [
    'openid',
    'email',
    'profile',
  ])

  const cookieStore = await cookies()

  cookieStore.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })

  cookieStore.set('oauth_code_verifier', codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })

  // Carry an invite token through the OAuth redirect so that a new user
  // coming from an invite link is auto-joined to the subscription on
  // successful login. Token format validated by the accept route.
  const invite = new URL(req.url).searchParams.get('invite')
  if (invite && /^[A-Za-z0-9_-]{16,64}$/.test(invite)) {
    cookieStore.set('oauth_invite_token', invite, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })
  }

  return NextResponse.redirect(url.toString())
}

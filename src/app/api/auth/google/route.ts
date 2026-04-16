import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  getGoogleProvider,
  generateState,
  generateCodeVerifier,
} from '@/lib/oauth-google'

export async function GET() {
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
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  })

  cookieStore.set('oauth_code_verifier', codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })

  return NextResponse.redirect(url.toString())
}

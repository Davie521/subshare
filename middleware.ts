import { NextRequest, NextResponse } from 'next/server'

const SESSION_COOKIE = 'subshare_session'

const PROTECTED_PREFIXES = ['/dashboard', '/groups', '/subscriptions', '/settings']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
  if (!isProtected) return NextResponse.next()

  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token || !token.includes('.')) {
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/groups/:path*', '/subscriptions/:path*', '/settings/:path*'],
}

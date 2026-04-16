import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestUrl } from '@/lib/request-url'

const SESSION_COOKIE = 'subshare_session'

const PROTECTED_PAGE_PREFIXES = [
  '/dashboard',
  '/subscriptions',
  '/settings',
  '/settlement',
  '/friends',
  '/activity',
]

/**
 * API paths that handle their own auth (or are intentionally public).
 * Everything else under /api/* requires a session cookie to even reach
 * the route handler.
 */
const PUBLIC_API_PREFIXES = [
  '/api/auth',
  '/api/cron',
  '/api/health',
  '/api/icons',
]

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

function isProtectedApi(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false
  return !PUBLIC_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

// Defence-in-depth: the middleware runs on the Edge runtime where HMAC
// verification is awkward. Route handlers always re-validate via
// getSession(), so we only enforce a *structural* sanity check here to
// cheaply reject requests with no or obviously-malformed cookies.
function looksLikeSession(token: string | undefined): token is string {
  if (!token) return false
  const parts = token.split('.')
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = req.cookies.get(SESSION_COOKIE)?.value

  if (isProtectedApi(pathname)) {
    if (!looksLikeSession(token)) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }
    return NextResponse.next()
  }

  if (isProtectedPage(pathname)) {
    if (!looksLikeSession(token)) {
      return NextResponse.redirect(resolveRequestUrl(req, '/login'))
    }
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/subscriptions/:path*',
    '/settings/:path*',
    '/settlement/:path*',
    '/friends/:path*',
    '/activity/:path*',
    '/api/:path*',
  ],
}

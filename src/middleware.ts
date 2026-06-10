import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

const { pathname } = request.nextUrl
const sp = request.nextUrl.searchParams

const isRecoveryFlow =
  sp.get('type') === 'recovery' ||
  sp.has('access_token') ||
  sp.has('refresh_token') ||
  sp.has('code')

if (isRecoveryFlow && pathname !== '/reset-password') {
  const url = request.nextUrl.clone()
  url.pathname = '/reset-password'
  return NextResponse.redirect(url)
}
  // Auth callback — always allow through without redirects
  if (pathname.startsWith('/auth/')) {
    return supabaseResponse
  }

  // ── Recovery flow ─────────────────────────────────────────────────────────
  // Supabase may include these params on any URL after verifying a recovery token.
  // Redirect to /reset-password so the hash/code isn't lost to a later redirect.
  const hasRecoveryParam =
    sp.get('type') === 'recovery' ||
    sp.has('access_token') ||
    sp.has('refresh_token')
    sp.has('code') || 
    sp.has('error') ||
    sp.has('error_code') 

  if (hasRecoveryParam) {
    if (pathname !== '/reset-password') {
      const url = request.nextUrl.clone()
      url.pathname = '/reset-password'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // Cookie set by /auth/callback after a successful recovery code exchange.
  // Keeps an authenticated user on /reset-password even if they navigate away.
  const recoveryInProgress = !!request.cookies.get('recovery_in_progress')?.value
  if (recoveryInProgress && user && pathname !== '/reset-password') {
    const url = request.nextUrl.clone()
    url.pathname = '/reset-password'
    return NextResponse.redirect(url)
  }
  // ── End recovery flow ─────────────────────────────────────────────────────

  // Read the staff_session cookie once — used in multiple branches below
  const staffSessionToken = request.cookies.get('staff_session')?.value
  const hasStaffSession = !!staffSessionToken

  console.log(`[Middleware] ${pathname} | supabase_user=${!!user} | staff_session_cookie=${hasStaffSession}`)

  // Staff PIN login page: if the staff already has a session cookie, redirect
  // them directly to the POS so they don't have to log in again.
  // Full DB validation of the session happens in the /shitjet page itself,
  // so an expired/invalid cookie will still land on /staff-login via the page redirect.
  if (pathname === '/staff-login') {
    if (hasStaffSession) {
      console.log('[Middleware] /staff-login: staff_session cookie present → redirecting to /shitjet')
      const url = request.nextUrl.clone()
      url.pathname = '/shitjet'
      return NextResponse.redirect(url)
    }
    console.log('[Middleware] /staff-login: no session → allowing public access')
    return supabaseResponse
  }

  // Routes that staff with a PIN session can access (no Supabase auth needed)
  const STAFF_ALLOWED_PATHS = ['/shitjet', '/historiku']
  const isStaffAllowedPath = STAFF_ALLOWED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )

  // Pages accessible without a Supabase session
  const isPublicAuthPage =
    pathname === '/login' ||
    pathname === '/login/options' ||
    pathname === '/register' ||
    pathname === '/login/manager' ||
    pathname === '/login/manager/forgot-password' ||
    pathname === '/login/manager/reset-password' ||
    pathname === '/reset-password'

  // Redirect authenticated users away from these pages
  const isLoginPage =
    pathname === '/login' ||
    pathname === '/login/options' ||
    pathname === '/register' ||
    pathname === '/login/manager'

  if (!user && !isPublicAuthPage) {
    if (isStaffAllowedPath && hasStaffSession) {
      // Cookie found — allow through. Full session validation (expiry, isActive,
      // subscription) is enforced inside the page and API routes.
      console.log(`[Middleware] ${pathname}: staff_session cookie found → allowing staff through`)
      return supabaseResponse
    }
    if (isStaffAllowedPath && !hasStaffSession) {
      // Staff route with no cookie at all → send to staff login
      console.log(`[Middleware] ${pathname}: staff route but no cookie → redirecting to /staff-login`)
      const url = request.nextUrl.clone()
      url.pathname = '/staff-login'
      return NextResponse.redirect(url)
    }
    // Non-staff route, no Supabase user → send to Supabase login
    console.log(`[Middleware] ${pathname}: no auth → redirecting to /login`)
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isLoginPage) {
    console.log(`[Middleware] ${pathname}: authenticated user on auth page → redirecting to /`)
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}

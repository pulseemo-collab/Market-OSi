import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('X-Request-Id', requestId)
  return response
}

export async function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID()
  const { pathname } = request.nextUrl

  // API routes: inject requestId as a request header (readable via headers() from next/headers
  // in route handlers) and as a response header (returned to clients). Supabase auth and
  // redirect logic are handled per-route — skip them here to avoid redundant overhead.
  if (pathname.startsWith('/api/')) {
    const apiReqHeaders = new Headers(request.headers)
    apiReqHeaders.set('x-request-id', requestId)
    const apiRes = NextResponse.next({ request: { headers: apiReqHeaders } })
    apiRes.headers.set('X-Request-Id', requestId)
    return apiRes
  }

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

  const sp = request.nextUrl.searchParams

  // Auth callback must be allowed through BEFORE the recovery-flow check so that
  // a normal login ?code= param is not mistaken for a password-reset code.
  if (pathname.startsWith('/auth/')) {
    return withRequestId(supabaseResponse, requestId)
  }

  // Recovery flow: any of these params on a non-/reset-password page means the
  // link was opened directly. Redirect to /reset-password, preserving the params.
  const isRecoveryFlow =
    sp.get('type') === 'recovery' ||
    sp.has('access_token') ||
    sp.has('refresh_token') ||
    sp.has('code') ||
    sp.has('error') ||
    sp.has('error_code')

  if (isRecoveryFlow && pathname !== '/reset-password') {
    const url = request.nextUrl.clone()
    url.pathname = '/reset-password'
    return withRequestId(NextResponse.redirect(url), requestId)
  }

  // Cookie set by /auth/callback after a successful recovery code exchange.
  const recoveryInProgress = !!request.cookies.get('recovery_in_progress')?.value
  if (recoveryInProgress && user && pathname !== '/reset-password') {
    const url = request.nextUrl.clone()
    url.pathname = '/reset-password'
    return withRequestId(NextResponse.redirect(url), requestId)
  }

  // Read the staff_session cookie once — used in multiple branches below
  const staffSessionToken = request.cookies.get('staff_session')?.value
  const hasStaffSession = !!staffSessionToken

  // Staff PIN login page: if the staff already has a session cookie, redirect
  // them directly to the POS so they don't have to log in again.
  if (pathname === '/staff-login') {
    if (hasStaffSession) {
      const url = request.nextUrl.clone()
      url.pathname = '/shitjet'
      return withRequestId(NextResponse.redirect(url), requestId)
    }
    return withRequestId(supabaseResponse, requestId)
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
      return withRequestId(supabaseResponse, requestId)
    }
    if (isStaffAllowedPath && !hasStaffSession) {
      const url = request.nextUrl.clone()
      url.pathname = '/staff-login'
      return withRequestId(NextResponse.redirect(url), requestId)
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRequestId(NextResponse.redirect(url), requestId)
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return withRequestId(NextResponse.redirect(url), requestId)
  }

  return withRequestId(supabaseResponse, requestId)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

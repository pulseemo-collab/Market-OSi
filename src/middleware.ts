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

  const isAuthPage = pathname === '/login' || pathname === '/login/manager'

  if (!user && !isAuthPage) {
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

  if (user && isAuthPage) {
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

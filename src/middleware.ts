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

  // Staff PIN login page is always public
  if (pathname === '/staff-login') {
    return supabaseResponse
  }

  // Routes that staff with a PIN session can access (no Supabase auth needed)
  const STAFF_ALLOWED_PATHS = ['/shitjet', '/historiku']
  const isStaffAllowedPath = STAFF_ALLOWED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
  const hasStaffSession = !!request.cookies.get('staff_session')?.value

  const isAuthPage = pathname === '/login' || pathname === '/login/manager'

  if (!user && !isAuthPage) {
    if (isStaffAllowedPath && hasStaffSession) {
      // Allow through — actual session validation happens in the page/API
      return supabaseResponse
    }
    if (isStaffAllowedPath && !hasStaffSession) {
      // No session at all on a staff route — go to staff login
      const url = request.nextUrl.clone()
      url.pathname = '/staff-login'
      return NextResponse.redirect(url)
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}

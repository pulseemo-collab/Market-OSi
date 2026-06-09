import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/login/manager'

  if (code) {
    const isRecovery = type === 'recovery' || next === '/reset-password'
    const redirectPath = isRecovery ? '/reset-password' : next

    // Create the redirect response first so the Supabase client can bind
    // Set-Cookie headers directly onto it (not onto a throw-away internal response).
    const response = NextResponse.redirect(`${origin}${redirectPath}`)

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value)
              response.cookies.set(name, value, options)
            })
          },
        },
      },
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      if (isRecovery) {
        response.cookies.set('recovery_in_progress', '1', {
          maxAge: 600,
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
        })
      }
      return response
    }
  }

  return NextResponse.redirect(`${origin}/login/manager?error=link_expired`)
}

import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/login/manager'

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Recovery flows always land on /reset-password
      const isRecovery = type === 'recovery' || next === '/reset-password'
      const redirectPath = isRecovery ? '/reset-password' : next

      const response = NextResponse.redirect(`${origin}${redirectPath}`)

      if (isRecovery) {
        // Short-lived cookie so middleware can detect an active recovery session
        // and prevent it from being redirected away from /reset-password
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

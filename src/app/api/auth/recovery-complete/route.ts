import { NextRequest, NextResponse } from 'next/server'
import { instrumentRoute } from '@/lib/logger'

/**
 * Clears the `recovery_in_progress` flag set by /auth/callback.
 *
 * That cookie is httpOnly, so the reset page cannot delete it itself, and while
 * it is present middleware redirects every authenticated request to
 * /reset-password. Without this endpoint a user who successfully changed their
 * password was bounced straight back to the reset form on their next login and
 * stayed stuck there until the cookie expired ten minutes later.
 *
 * Deliberately unauthenticated: it only drops a flag belonging to the caller's
 * own browser and grants no access on its own.
 */
async function handlePost(_req: NextRequest) {
  const res = NextResponse.json({ ok: true })

  res.cookies.set('recovery_in_progress', '', {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })

  return res
}

export const POST = instrumentRoute('/api/auth/recovery-complete', handlePost)

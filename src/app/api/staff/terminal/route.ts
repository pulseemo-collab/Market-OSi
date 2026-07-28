import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { setTerminalOrgCookie } from '@/lib/staff-auth'
import { rateLimit } from '@/lib/rate-limit'
import { instrumentRoute } from '@/lib/logger'

async function handlePost(req: NextRequest) {
  const { organizationId, error } = await requireRole(['Administrator', 'Manager'])
  if (error) return error

  const rl = rateLimit(req, 'staff', null, organizationId)
  if (rl.limited) return rl.response!

  const res = NextResponse.json({ success: true, organizationId })
  setTerminalOrgCookie(res, organizationId!)
  return res
}

export const POST = instrumentRoute('/api/staff/terminal', handlePost)

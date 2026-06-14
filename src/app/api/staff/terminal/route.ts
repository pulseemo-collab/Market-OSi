import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { setTerminalOrgCookie } from '@/lib/staff-auth'

export async function POST(req: NextRequest) {
  const { organizationId, error } = await requireRole(['Administrator', 'Manager'])
  if (error) return error

  const res = NextResponse.json({ success: true, organizationId })
  setTerminalOrgCookie(res, organizationId!)
  return res
}

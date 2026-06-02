import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('billing:read')
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  return NextResponse.json({ subscriptions: [] })
}

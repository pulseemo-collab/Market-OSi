import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const { userId, organizationId, error } = await requirePermission('billing:read')
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  void params
  return NextResponse.json({ subscription: null })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const { userId, organizationId, error } = await requirePermission('billing:manage')
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  void params
  return NextResponse.json({ error: 'Faturimi nuk është aktiv ende' }, { status: 503 })
}

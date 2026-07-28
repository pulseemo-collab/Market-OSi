import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'

export const dynamic = 'force-dynamic'

async function handleGet(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('billing:read')
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const subscriptions = await prisma.subscription.findMany({
      include: { organization: { select: { id: true, name: true, isActive: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ subscriptions })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/subscriptions', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/platform/subscriptions', handleGet)

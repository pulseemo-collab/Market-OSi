import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { CACHE_TTL, PLATFORM_TAG, cached } from '@/lib/cache'
import { ORG_SCAN_LIMIT } from '@/lib/platform-orgs'
import { derivePlatformAlerts, type AlertSeverity } from '@/lib/platform-alerts'

export const dynamic = 'force-dynamic'

const PLATFORM_SCOPE = 0

/**
 * The attention queue.
 *
 * Nothing is stored. Every alert is derived on read from the organization rows
 * and their subscriptions, which means an alert cannot go stale and there is no
 * acknowledgement state to keep in sync with reality — fixing the underlying
 * condition removes the alert on the next load. See `lib/platform-alerts.ts`.
 */
async function loadAlertRows() {
  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      createdAt: true,
      subscription: {
        select: {
          plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true,
          cancelAtPeriodEnd: true, cancelledAt: true,
        },
      },
      sales: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: ORG_SCAN_LIMIT,
  })

  return organizations.map((org) => ({
    id: org.id,
    name: org.name,
    isActive: org.isActive,
    createdAt: org.createdAt,
    subscription: org.subscription,
    lastActivity: org.sales[0]?.createdAt ?? null,
  }))
}

async function handleGet(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('platform:read')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const rows = await cached(
      {
        namespace: 'platform-alerts',
        organizationId: PLATFORM_SCOPE,
        ttlMs: CACHE_TTL.platform,
        tags: [PLATFORM_TAG],
      },
      loadAlertRows,
    )

    const all = derivePlatformAlerts(rows)

    const severity = new URL(req.url).searchParams.get('severity')
    const filtered =
      severity === 'high' || severity === 'medium' || severity === 'low'
        ? all.filter((a) => a.severity === severity)
        : all

    const counts = all.reduce(
      (acc, a) => {
        acc[a.severity] += 1
        return acc
      },
      { high: 0, medium: 0, low: 0 } as Record<AlertSeverity, number>,
    )

    return NextResponse.json({
      alerts: filtered,
      counts,
      total: all.length,
      organizationsScanned: rows.length,
    })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/alerts', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/platform/alerts', handleGet)

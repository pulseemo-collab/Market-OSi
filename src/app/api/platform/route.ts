import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { CACHE_TTL, PLATFORM_TAG, cached } from '@/lib/cache'
import { countByState } from '@/lib/platform-orgs'
import { derivePlatformAlerts, type AlertSeverity } from '@/lib/platform-alerts'

export const dynamic = 'force-dynamic'

/**
 * Cross-tenant statistics: six full-table counts plus a row per organization.
 * The cost grows with the number of tenants, which is exactly the direction
 * this system is scaling, so the result is cached and shared.
 *
 * Keyed under organization 0 because the payload belongs to the platform rather
 * than to any tenant.
 */
const PLATFORM_SCOPE = 0

async function buildPlatformStats() {
  const [
    totalOrganizations,
    totalUsers,
    totalStaff,
    totalProducts,
    salesAgg,
    salesLast30,
    totalNotifications,
    totalAuditLogs,
    organizations,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.userRole.count(),
    prisma.staff.count(),
    prisma.product.count(),
    prisma.sale.aggregate({ _count: { _all: true }, _sum: { totali: true } }),
    // A rolling window is the only revenue figure this schema can honestly
    // produce: sales totals are real money that moved, subscription prices are
    // not billed by this system at all.
    prisma.sale.aggregate({
      _count: { _all: true },
      _sum: { totali: true },
      where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
    }),
    prisma.notification.count(),
    prisma.auditLog.count(),
    prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        subscription: {
          // cancelAtPeriodEnd and cancelledAt are what make a customer's
          // cancellation visible here. Without them a tenant that had cancelled
          // renewal was indistinguishable from an ordinary active one.
          select: {
            plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true,
            nextPlan: true, cancelAtPeriodEnd: true, cancelledAt: true,
          },
        },
        _count: { select: { userRoles: true, staff: true, products: true, sales: true } },
        sales: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ])

  const orgsTable = organizations.map((org) => ({
    id: org.id,
    name: org.name,
    isActive: org.isActive,
    usersCount: org._count.userRoles,
    staffCount: org._count.staff,
    productsCount: org._count.products,
    salesCount: org._count.sales,
    lastActivity: org.sales[0]?.createdAt ?? null,
    createdAt: org.createdAt,
    subscription: org.subscription
      ? {
          plan: org.subscription.plan,
          status: org.subscription.status,
          trialEndsAt: org.subscription.trialEndsAt,
          currentPeriodEnd: org.subscription.currentPeriodEnd,
          nextPlan: org.subscription.nextPlan,
          cancelAtPeriodEnd: org.subscription.cancelAtPeriodEnd,
          cancelledAt: org.subscription.cancelledAt,
        }
      : null,
  }))

  // The tally and the attention queue are computed here, from the same rows the
  // table renders, so a badge and a summary count can never disagree.
  const stateCounts = countByState(orgsTable)
  const alerts = derivePlatformAlerts(orgsTable)
  const alertCounts = alerts.reduce(
    (acc, a) => {
      acc[a.severity] += 1
      return acc
    },
    { high: 0, medium: 0, low: 0 } as Record<AlertSeverity, number>,
  )

  return {
    totalOrganizations,
    totalUsers,
    totalStaff,
    totalProducts,
    totalSales: salesAgg._count._all,
    totalRevenue: salesAgg._sum.totali ?? 0,
    salesLast30Days: salesLast30._count._all,
    revenueLast30Days: salesLast30._sum.totali ?? 0,
    totalNotifications,
    totalAuditLogs,
    stateCounts,
    alertCounts,
    alertsTotal: alerts.length,
    /** The most urgent handful, so the overview needs no second round trip. */
    topAlerts: alerts.slice(0, 6),
    organizations: orgsTable,
  }
}

async function handleGet(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('platform:read')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const stats = await cached(
      {
        namespace: 'platform',
        organizationId: PLATFORM_SCOPE,
        ttlMs: CACHE_TTL.platform,
        tags: [PLATFORM_TAG],
      },
      buildPlatformStats,
    )

    return NextResponse.json(stats)
  } catch (err) {
    captureApiError(err, { route: '/api/platform', action: 'GET' })
    console.error('Platform dashboard error:', err)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/platform', handleGet)

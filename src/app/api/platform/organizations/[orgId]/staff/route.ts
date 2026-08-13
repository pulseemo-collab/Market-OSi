import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { orgId: string } }

/**
 * PIN staff for one tenant, for operator inspection only.
 *
 * The select list is explicit and deliberately excludes `pinHash`. A Platform
 * Owner has a legitimate need to know that a staff member exists, whether the
 * account is usable, and whether it is currently locked out — and no need
 * whatsoever for the credential itself. Enumerating the fields rather than
 * spreading the record means a column added to `Staff` later cannot leak here by
 * default.
 */
async function handleGet(req: NextRequest, { params }: RouteContext) {
  const { userId, organizationId, error } = await requirePermission('organizations:read')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
  }

  try {
    const now = new Date()

    const staff = await prisma.staff.findMany({
      where: { organizationId: orgId },
      orderBy: [{ isActive: 'desc' }, { emri: 'asc' }],
      select: {
        id: true,
        emri: true,
        kodi: true,
        roli: true,
        isActive: true,
        failedAttempts: true,
        lockedUntil: true,
        createdAt: true,
        _count: { select: { sales: true, sessions: true } },
      },
    })

    // The most recent sale per staff member is the only "last seen" signal this
    // schema carries: staff sessions are deleted on logout and expiry, so their
    // absence would misreport an active cashier as never having logged in.
    const lastSales = await prisma.sale.groupBy({
      by: ['staffId'],
      where: { organizationId: orgId, staffId: { not: null } },
      _max: { createdAt: true },
    })
    const lastSaleByStaff = new Map(lastSales.map((r) => [r.staffId, r._max.createdAt]))

    return NextResponse.json({
      staff: staff.map((s) => ({
        id: s.id,
        emri: s.emri,
        kodi: s.kodi,
        roli: s.roli,
        isActive: s.isActive,
        isLocked: !!(s.lockedUntil && s.lockedUntil > now),
        lockedUntil: s.lockedUntil,
        failedAttempts: s.failedAttempts,
        createdAt: s.createdAt,
        salesCount: s._count.sales,
        activeSessions: s._count.sessions,
        lastSaleAt: lastSaleByStaff.get(s.id) ?? null,
      })),
    })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations/[orgId]/staff', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute<RouteContext>(
  '/api/platform/organizations/[orgId]/staff',
  handleGet,
)

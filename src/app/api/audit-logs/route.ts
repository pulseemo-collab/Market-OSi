import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { paginationHeaders, parsePageRequest } from '@/lib/pagination'

export const dynamic = 'force-dynamic'

/** Audit history is the fastest-growing table; an unpaginated read stays bounded. */
const AUDIT_SAFETY_LIMIT = 500

async function handleGet(req: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('audit:read')
  if (error) return error

  const rl = rateLimit(req, 'audit-logs', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  try {
    const { searchParams } = new URL(req.url)
    const filterUserId = searchParams.get('userId') || undefined
    const action = searchParams.get('action') || undefined
    const entityType = searchParams.get('entityType') || undefined
    const nga = searchParams.get('nga') || undefined
    const deri = searchParams.get('deri') || undefined

    const dateFilter = nga || deri
      ? {
          createdAt: {
            ...(nga ? { gte: new Date(nga) } : {}),
            ...(deri ? { lte: new Date(new Date(deri).setHours(23, 59, 59, 999)) } : {}),
          },
        }
      : {}

    const where = {
      organizationId: organizationId!,
      ...(filterUserId ? { userId: filterUserId } : {}),
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
      ...dateFilter,
    }

    const page = parsePageRequest(searchParams, {
      defaultPageSize: 100,
      safetyLimit: AUDIT_SAFETY_LIMIT,
    })

    const [logs, users, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        // createdAt ties are common when a mutation writes several entries, so
        // id keeps the ordering deterministic across pages.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.take,
        skip: page.explicit ? page.skip : 0,
      }),
      prisma.userRole.findMany({
        where: { organizationId: organizationId! },
        select: { userId: true, email: true, roli: true },
        orderBy: [{ email: 'asc' }, { userId: 'asc' }],
      }),
      page.explicit ? prisma.auditLog.count({ where }) : Promise.resolve(0),
    ])

    return NextResponse.json(
      { logs, users },
      page.explicit ? { headers: paginationHeaders(page, total) } : undefined,
    )
  } catch (err) {
    console.error('Audit logs GET error:', err)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/audit-logs', handleGet)

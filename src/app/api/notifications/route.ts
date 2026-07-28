import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { paginationHeaders, parsePageRequest } from '@/lib/pagination'

export const dynamic = 'force-dynamic'

async function handleGet(req: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('notifications:read')
  if (error) return error

  const rl = rateLimit(req, 'notifications', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  try {
    const { searchParams } = new URL(req.url)
    const countOnly = searchParams.get('countOnly') === 'true'
    const unreadOnly = searchParams.get('unreadOnly') === 'true'

    // Cashiers only see notifications assigned to them
    const userFilter = role === 'Cashier' ? { userId: userId! } : {}

    const baseWhere = { organizationId: organizationId!, ...userFilter }
    const unreadWhere = { ...baseWhere, isRead: false }
    const listWhere = unreadOnly ? unreadWhere : baseWhere

    if (countOnly) {
      const unreadCount = await prisma.notification.count({ where: unreadWhere })
      return NextResponse.json({ unreadCount })
    }

    // The existing limit/skip contract is preserved; the shared parser adds the
    // page-size ceiling and a default for callers that send neither.
    const page = parsePageRequest(searchParams, { defaultPageSize: 50, maxPageSize: 100 })
    const take = page.explicit ? page.take : 50

    const [notifications, unreadCount, listTotal] = await Promise.all([
      prisma.notification.findMany({
        where: listWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        skip: page.skip,
      }),
      prisma.notification.count({ where: unreadWhere }),
      page.explicit && !unreadOnly
        ? prisma.notification.count({ where: listWhere })
        : Promise.resolve(null),
    ])

    return NextResponse.json(
      { notifications, unreadCount },
      page.explicit
        ? { headers: paginationHeaders(page, listTotal ?? unreadCount) }
        : undefined,
    )
  } catch (err) {
    console.error('[Notifications] GET error:', err)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/notifications', handleGet)

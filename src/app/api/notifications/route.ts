import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('notifications:read')
  if (error) return error

  const rl = rateLimit(req, 'notifications', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

  try {
    const { searchParams } = new URL(req.url)
    const countOnly = searchParams.get('countOnly') === 'true'
    const unreadOnly = searchParams.get('unreadOnly') === 'true'
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const skip = parseInt(searchParams.get('skip') || '0')

    // Cashiers only see notifications assigned to them
    const userFilter = role === 'cashier' ? { userId: userId! } : {}

    const baseWhere = { organizationId: organizationId!, ...userFilter }
    const unreadWhere = { ...baseWhere, isRead: false }
    const listWhere = unreadOnly ? unreadWhere : baseWhere

    if (countOnly) {
      const unreadCount = await prisma.notification.count({ where: unreadWhere })
      return NextResponse.json({ unreadCount })
    }

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: listWhere,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.notification.count({ where: unreadWhere }),
    ])

    return NextResponse.json({ notifications, unreadCount })
  } catch (err) {
    console.error('[Notifications] GET error:', err)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

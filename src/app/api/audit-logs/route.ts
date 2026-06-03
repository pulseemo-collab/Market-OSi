import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('audit:read')
  if (error) return error

  const rl = rateLimit(req, 'audit-logs', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

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

    const [logs, users] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          organizationId: organizationId!,
          ...(filterUserId ? { userId: filterUserId } : {}),
          ...(action ? { action } : {}),
          ...(entityType ? { entityType } : {}),
          ...dateFilter,
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      prisma.userRole.findMany({
        where: { organizationId: organizationId! },
        select: { userId: true, email: true, roli: true },
        orderBy: { email: 'asc' },
      }),
    ])

    return NextResponse.json({ logs, users })
  } catch (err) {
    console.error('Audit logs GET error:', err)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'

async function handlePost(_req: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('notifications:read')
  if (error) return error

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse('Abonimi ka skaduar', 403)

  try {
    const userFilter = role === 'Cashier' ? { userId: userId! } : {}
    const where = {
      organizationId: organizationId!,
      isRead: false,
      ...userFilter,
    }

    await prisma.notification.updateMany({ where, data: { isRead: true } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[Notifications] mark-all-read error:', err)
    return errorResponse('Gabim në server', 500)
  }
}

export const POST = instrumentRoute('/api/notifications/mark-all-read', handlePost)

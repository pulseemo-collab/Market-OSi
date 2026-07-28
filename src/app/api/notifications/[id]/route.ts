import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'

type RouteContext = { params: { id: string } }

async function handlePatch(_req: NextRequest, { params }: RouteContext) {
  const { userId, role, organizationId, error } = await requirePermission('notifications:read')
  if (error) return error

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse('Abonimi ka skaduar', 403)

  const id = parseInt(params.id)
  if (isNaN(id)) {
    return errorResponse('ID i pavlefshëm', 400)
  }

  try {
    const notification = await prisma.notification.findFirst({
      where: { id, organizationId: organizationId! },
    })
    if (!notification) {
      return errorResponse('Njoftimi nuk u gjet', 404)
    }

    // Cashier can only mark their own notifications
    if (role === 'Cashier' && notification.userId !== userId) {
      return errorResponse('Nuk ke akses', 403)
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('[Notifications] PATCH error:', err)
    return errorResponse('Gabim në server', 500)
  }
}

export const PATCH = instrumentRoute<RouteContext>('/api/notifications/[id]', handlePatch)

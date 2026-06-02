import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, role, organizationId, error } = await requirePermission('notifications:read')
  if (error) return error

  const id = parseInt(params.id)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
  }

  try {
    const notification = await prisma.notification.findFirst({
      where: { id, organizationId: organizationId! },
    })
    if (!notification) {
      return NextResponse.json({ error: 'Njoftimi nuk u gjet' }, { status: 404 })
    }

    // Cashier can only mark their own notifications
    if (role === 'cashier' && notification.userId !== userId) {
      return NextResponse.json({ error: 'Nuk ke akses' }, { status: 403 })
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('[Notifications] PATCH error:', err)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

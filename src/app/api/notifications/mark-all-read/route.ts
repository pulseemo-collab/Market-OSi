import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'

export async function POST(_req: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('notifications:read')
  if (error) return error

  try {
    const userFilter = role === 'cashier' ? { userId: userId! } : {}
    const where = {
      organizationId: organizationId!,
      isRead: false,
      ...userFilter,
    }

    await prisma.notification.updateMany({ where, data: { isRead: true } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[Notifications] mark-all-read error:', err)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

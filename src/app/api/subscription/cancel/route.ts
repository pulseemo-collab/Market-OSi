import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'

export async function POST() {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['owner'])
  if (error) return error

  if (!organizationId) {
    return NextResponse.json({ error: 'Organizata nuk u gjet' }, { status: 400 })
  }

  const existing = await prisma.subscription.findUnique({ where: { organizationId } })
  if (!existing) {
    return NextResponse.json({ error: 'Abonimi nuk u gjet' }, { status: 404 })
  }

  if (existing.status === 'cancelled') {
    return NextResponse.json({ error: 'Abonimi është tashmë i anuluar' }, { status: 400 })
  }

  const updated = await prisma.subscription.update({
    where: { organizationId },
    data: { status: 'cancelled' },
  })

  await prisma.billingAuditLog.create({
    data: {
      organizationId,
      changedByUserId: userId!,
      changedByEmail: userEmail!,
      oldStatus: existing.status,
      newStatus: 'cancelled',
      notes: 'Anuluar nga pronari',
    },
  })

  logAuditAction({
    userId: userId!,
    userEmail: userEmail!,
    userRole: role!,
    organizationId,
    action: AUDIT_ACTIONS.BILLING_STATUS_CHANGED,
    entityType: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
    description: 'Abonimi u anulua nga pronari',
  }).catch(() => {})

  return NextResponse.json({ success: true, status: updated.status })
}

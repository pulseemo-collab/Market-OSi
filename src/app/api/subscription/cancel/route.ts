import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'

export async function POST(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['owner'])
  if (error) return error

  if (!organizationId) {
    return NextResponse.json({ error: 'Organizata nuk u gjet' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({})) as { action?: string }
  const action = body.action ?? 'cancel'

  const existing = await prisma.subscription.findUnique({ where: { organizationId } })
  if (!existing) {
    return NextResponse.json({ error: 'Abonimi nuk u gjet' }, { status: 404 })
  }

  const now = new Date()

  // ── Undo scheduled cancellation ──────────────────────────────────────────────
  if (action === 'undo') {
    if (!existing.cancelAtPeriodEnd) {
      return NextResponse.json({ error: 'Nuk ka anulim të planifikuar' }, { status: 400 })
    }

    await prisma.subscription.update({
      where: { organizationId },
      data: { cancelAtPeriodEnd: false, cancelledAt: null },
    })

    await prisma.billingAuditLog.create({
      data: {
        organizationId,
        changedByUserId: userId!,
        changedByEmail: userEmail!,
        notes: 'Anulimi i planifikuar u hoq (riaktivizim automatik)',
      },
    })

    logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId,
      action: AUDIT_ACTIONS.BILLING_STATUS_CHANGED,
      entityType: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
      description: 'Anulimi i planifikuar u hoq nga pronari',
    }).catch(() => {})

    return NextResponse.json({ success: true, undone: true })
  }

  // ── Cancel ───────────────────────────────────────────────────────────────────
  if (existing.status === 'cancelled') {
    return NextResponse.json({ error: 'Abonimi është tashmë i anuluar' }, { status: 400 })
  }
  if (existing.cancelAtPeriodEnd) {
    return NextResponse.json({ error: 'Anulimi është tashmë i planifikuar' }, { status: 400 })
  }

  const isTrialing = existing.status === 'trialing'
  const hasFuturePeriod = existing.currentPeriodEnd && existing.currentPeriodEnd > now

  if (!isTrialing && hasFuturePeriod) {
    // Schedule cancellation at period end — keep access until then
    await prisma.subscription.update({
      where: { organizationId },
      data: { cancelAtPeriodEnd: true, cancelledAt: now },
    })

    await prisma.billingAuditLog.create({
      data: {
        organizationId,
        changedByUserId: userId!,
        changedByEmail: userEmail!,
        oldStatus: existing.status,
        newStatus: existing.status,
        notes: `Anulimi planifikuar në fund të periudhës: ${existing.currentPeriodEnd!.toLocaleDateString('sq-AL')}`,
      },
    })

    logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId,
      action: AUDIT_ACTIONS.BILLING_STATUS_CHANGED,
      entityType: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
      description: 'Rinovimi u anulua — aksesi vazhdon deri në fund të periudhës',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      scheduledCancel: true,
      cancelAt: existing.currentPeriodEnd!.toISOString(),
    })
  }

  // Immediate cancellation (trial or no future period)
  await prisma.subscription.update({
    where: { organizationId },
    data: { status: 'cancelled', cancelledAt: now, cancelAtPeriodEnd: false },
  })

  await prisma.billingAuditLog.create({
    data: {
      organizationId,
      changedByUserId: userId!,
      changedByEmail: userEmail!,
      oldStatus: existing.status,
      newStatus: 'cancelled',
      notes: isTrialing ? 'Periudha e provës u anulua nga pronari' : 'Anuluar nga pronari (pa periudhë aktive)',
    },
  })

  logAuditAction({
    userId: userId!,
    userEmail: userEmail!,
    userRole: role!,
    organizationId,
    action: AUDIT_ACTIONS.BILLING_STATUS_CHANGED,
    entityType: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
    description: isTrialing ? 'Trial u anulua nga pronari' : 'Abonimi u anulua nga pronari',
  }).catch(() => {})

  return NextResponse.json({ success: true, scheduledCancel: false })
}

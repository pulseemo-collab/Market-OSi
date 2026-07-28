import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import { errorResponse, instrumentRoute } from '@/lib/logger'

async function handlePost(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['Administrator'])
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  if (!organizationId) {
    return errorResponse(req, 'Organizata nuk u gjet', 400)
  }

  const body = await req.json().catch(() => ({})) as { action?: string }
  const action = body.action ?? 'cancel'

  const existing = await prisma.subscription.findUnique({ where: { organizationId } })
  if (!existing) {
    return errorResponse(req, 'Abonimi nuk u gjet', 404)
  }

  const now = new Date()

  // ── Undo scheduled cancellation ──────────────────────────────────────────────
  if (action === 'undo') {
    if (!existing.cancelAtPeriodEnd) {
      return errorResponse(req, 'Nuk ka anulim të planifikuar', 400)
    }

    await prisma.subscription.update({
      where: { organizationId },
      data: { cancelAtPeriodEnd: false, closeAtPeriodEnd: false, cancelledAt: null },
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
    return errorResponse(req, 'Abonimi është tashmë i anuluar', 400)
  }
  if (existing.cancelAtPeriodEnd) {
    return errorResponse(req, 'Anulimi është tashmë i planifikuar', 400)
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

export const POST = instrumentRoute('/api/subscription/cancel', handlePost)

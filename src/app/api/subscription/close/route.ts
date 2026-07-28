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
  const action = body.action ?? 'close'

  const existing = await prisma.subscription.findUnique({ where: { organizationId } })
  if (!existing) {
    return errorResponse(req, 'Abonimi nuk u gjet', 404)
  }

  // ── Undo scheduled closure ───────────────────────────────────────────────────
  if (action === 'undo') {
    if (!existing.closeAtPeriodEnd) {
      return errorResponse(req, 'Nuk ka mbyllje të planifikuar', 400)
    }

    await prisma.subscription.update({
      where: { organizationId },
      data: { closeAtPeriodEnd: false, cancelAtPeriodEnd: false, cancelledAt: null },
    })

    await prisma.billingAuditLog.create({
      data: {
        organizationId,
        changedByUserId: userId!,
        changedByEmail: userEmail!,
        notes: 'Mbyllja e planifikuar e dyqanit u anulua nga pronari',
      },
    })

    logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId,
      action: AUDIT_ACTIONS.BILLING_STATUS_CHANGED,
      entityType: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
      description: 'Mbyllja e dyqanit u anulua nga pronari — rinovimi aktiv',
    }).catch(() => {})

    return NextResponse.json({ success: true, undone: true })
  }

  // ── Schedule closure ─────────────────────────────────────────────────────────
  if (existing.closeAtPeriodEnd) {
    return errorResponse(req, 'Mbyllja është tashmë e planifikuar', 400)
  }
  if (existing.status === 'cancelled') {
    return errorResponse(req, 'Abonimi është tashmë i anuluar', 400)
  }

  const now = new Date()

  await prisma.subscription.update({
    where: { organizationId },
    data: { closeAtPeriodEnd: true, cancelAtPeriodEnd: true, cancelledAt: now },
  })

  const closeAt = existing.currentPeriodEnd ?? existing.trialEndsAt

  await prisma.billingAuditLog.create({
    data: {
      organizationId,
      changedByUserId: userId!,
      changedByEmail: userEmail!,
      oldStatus: existing.status,
      newStatus: existing.status,
      notes: `Mbyllja e dyqanit planifikuar pas periudhës: ${closeAt?.toLocaleDateString('sq-AL') ?? '—'}`,
    },
  })

  logAuditAction({
    userId: userId!,
    userEmail: userEmail!,
    userRole: role!,
    organizationId,
    action: AUDIT_ACTIONS.BILLING_STATUS_CHANGED,
    entityType: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
    description: 'Mbyllja e dyqanit planifikuar nga pronari',
  }).catch(() => {})

  return NextResponse.json({
    success: true,
    closeAt: closeAt?.toISOString() ?? null,
  })
}

export const POST = instrumentRoute('/api/subscription/close', handlePost)

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import { errorResponse, instrumentRoute } from '@/lib/logger'

const PLAN_LABELS: Record<string, string> = { monthly: 'Mujor', yearly: 'Vjetor' }
const PLAN_DAYS: Record<string, number> = { monthly: 30, yearly: 365 }

async function handlePost(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['Administrator'])
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  if (!organizationId) {
    return errorResponse(req, 'Organizata nuk u gjet', 400)
  }

  const body = await req.json()
  const { plan } = body as { plan: string | null }

  if (plan !== null && plan !== 'monthly' && plan !== 'yearly') {
    return errorResponse(req, 'Plan i pavlefshëm', 400)
  }

  const existing = await prisma.subscription.findUnique({ where: { organizationId } })
  if (!existing) {
    return errorResponse(req, 'Abonimi nuk u gjet', 404)
  }

  if (plan !== null && existing.plan === plan) {
    return errorResponse(req, 'Plani i zgjedhur është i njëjtë me planin aktual', 400)
  }

  // Clearing next plan
  if (plan === null) {
    await prisma.subscription.update({
      where: { organizationId },
      data: { nextPlan: null },
    })
    return NextResponse.json({ success: true, nextPlan: null })
  }

  // Compute new period end: max(now, currentPeriodEnd, trialEndsAt) + plan days
  const now = new Date()
  const daysToAdd = PLAN_DAYS[plan] ?? 30
  const baseDate = new Date(
    Math.max(
      now.getTime(),
      existing.currentPeriodEnd?.getTime() ?? 0,
      existing.trialEndsAt?.getTime() ?? 0,
    ),
  )
  const newPeriodEnd = new Date(baseDate)
  newPeriodEnd.setDate(newPeriodEnd.getDate() + daysToAdd)

  await prisma.subscription.update({
    where: { organizationId },
    data: {
      nextPlan: plan,
      status: 'active',
      currentPeriodEnd: newPeriodEnd,
      currentPeriodStart: now,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    },
  })

  const oldLabel = PLAN_LABELS[existing.plan] ?? existing.plan
  const newLabel = PLAN_LABELS[plan] ?? plan

  // newPlan set + no newStatus → billing-history renders "Ndryshim plani: X → Y"
  await prisma.billingAuditLog.create({
    data: {
      organizationId,
      changedByUserId: userId!,
      changedByEmail: userEmail!,
      oldPlan: existing.plan,
      newPlan: plan,
      notes: `Ndryshim plani: ${oldLabel} → ${newLabel}`,
    },
  })

  logAuditAction({
    userId: userId!,
    userEmail: userEmail!,
    userRole: role!,
    organizationId,
    action: AUDIT_ACTIONS.BILLING_PLAN_CHANGED,
    entityType: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
    description: `Plani u ndryshua nga ${oldLabel} në ${newLabel}. Pagesa u simulua (${daysToAdd} ditë).`,
  }).catch(() => {})

  return NextResponse.json({ success: true, nextPlan: plan, newPeriodEnd: newPeriodEnd.toISOString() })
}

export const POST = instrumentRoute('/api/subscription/change-plan', handlePost)

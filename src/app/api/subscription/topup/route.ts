import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { PLAN_PRICES } from '@/lib/billing'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import { errorResponse, instrumentRoute } from '@/lib/logger'

const PLAN_DAILY_RATES: Record<string, number> = {
  monthly: PLAN_PRICES.monthly / 30,
  yearly:  PLAN_PRICES.yearly / 365,
}

async function handlePost(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['Administrator'])
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  if (!organizationId) {
    return errorResponse(req, 'Organizata nuk u gjet', 400)
  }

  const body = await req.json()
  const { days } = body as { days: number }

  if (!days || !Number.isInteger(days) || days < 1 || days > 1095) {
    return errorResponse(req, 'Numri i ditëve është i pavlefshëm', 400)
  }

  const existing = await prisma.subscription.findUnique({ where: { organizationId } })
  if (!existing) {
    return errorResponse(req, 'Abonimi nuk u gjet', 404)
  }

  const plan = existing.plan ?? 'monthly'
  const dailyRate = PLAN_DAILY_RATES[plan] ?? PLAN_DAILY_RATES.monthly
  const amount = Math.round(dailyRate * days)

  const now = new Date()
  const baseDate = new Date(
    Math.max(
      now.getTime(),
      existing.currentPeriodEnd?.getTime() ?? 0,
      existing.trialEndsAt?.getTime() ?? 0,
    ),
  )
  const newPeriodEnd = new Date(baseDate)
  newPeriodEnd.setDate(newPeriodEnd.getDate() + days)

  await prisma.subscription.update({
    where: { organizationId },
    data: {
      status: 'active',
      currentPeriodEnd: newPeriodEnd,
      currentPeriodStart: now,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    },
  })

  await prisma.billingAuditLog.create({
    data: {
      organizationId,
      changedByUserId: userId!,
      changedByEmail: userEmail!,
      oldPlan: existing.plan,
      newPlan: existing.plan,
      newStatus: 'active',
      notes: `Zgjatje abonimi: ${days} ditë`,
      amount,
    },
  })

  logAuditAction({
    userId: userId!,
    userEmail: userEmail!,
    userRole: role!,
    organizationId,
    action: AUDIT_ACTIONS.BILLING_STATUS_CHANGED,
    entityType: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
    description: `Abonimi u zgjat me ${days} ditë. Skadon: ${newPeriodEnd.toLocaleDateString('sq-AL')}`,
  }).catch(() => {})

  return NextResponse.json({ success: true, newPeriodEnd: newPeriodEnd.toISOString() })
}

export const POST = instrumentRoute('/api/subscription/topup', handlePost)

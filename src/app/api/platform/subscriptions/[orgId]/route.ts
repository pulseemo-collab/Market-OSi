import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { isValidPlan, isValidStatus } from '@/lib/billing'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const { userId, organizationId, error } = await requirePermission('billing:read')
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return NextResponse.json({ error: 'ID e pavlefshme' }, { status: 400 })
  }

  try {
    const [subscription, auditLogs] = await Promise.all([
      prisma.subscription.findUnique({ where: { organizationId: orgId } }),
      prisma.billingAuditLog.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ])

    return NextResponse.json({ subscription, auditLogs })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/subscriptions/[orgId]', action: 'GET' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const { userId, userEmail, organizationId, error } = await requirePermission('billing:manage')
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return NextResponse.json({ error: 'ID e pavlefshme' }, { status: 400 })
  }

  try {
    const body = await req.json()
    const { plan, status, trialEndsAt, currentPeriodStart, currentPeriodEnd, notes } = body

    if (plan !== undefined && !isValidPlan(plan)) {
      return NextResponse.json({ error: 'Plan i pavlefshëm' }, { status: 400 })
    }
    if (status !== undefined && !isValidStatus(status)) {
      return NextResponse.json({ error: 'Status i pavlefshëm' }, { status: 400 })
    }

    const existing = await prisma.subscription.findUnique({ where: { organizationId: orgId } })
    if (!existing) {
      return NextResponse.json({ error: 'Abonimi nuk u gjet' }, { status: 404 })
    }

    const updated = await prisma.subscription.update({
      where: { organizationId: orgId },
      data: {
        ...(plan !== undefined && { plan }),
        ...(status !== undefined && { status }),
        ...(trialEndsAt !== undefined && { trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null }),
        ...(currentPeriodStart !== undefined && { currentPeriodStart: currentPeriodStart ? new Date(currentPeriodStart) : null }),
        ...(currentPeriodEnd !== undefined && { currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
    })

    const planChanged   = plan   !== undefined && plan   !== existing.plan
    const statusChanged = status !== undefined && status !== existing.status

    if (planChanged || statusChanged) {
      await prisma.billingAuditLog.create({
        data: {
          organizationId: orgId,
          changedByUserId: userId ?? 'unknown',
          changedByEmail:  userEmail ?? 'unknown',
          oldPlan:    planChanged   ? existing.plan   : null,
          newPlan:    planChanged   ? plan             : null,
          oldStatus:  statusChanged ? existing.status  : null,
          newStatus:  statusChanged ? status            : null,
          notes:      notes ?? null,
        },
      })
    }

    return NextResponse.json({ subscription: updated })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/subscriptions/[orgId]', action: 'PUT' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

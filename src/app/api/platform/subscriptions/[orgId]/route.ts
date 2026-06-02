import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { isValidPlan, isValidStatus, BILLING_AUDIT_ACTIONS } from '@/lib/billing'

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
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId: orgId },
      include: {
        billingAuditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    })

    return NextResponse.json({ subscription })
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
    const { plan, status, trialStartsAt, trialEndsAt, currentPeriodStart, currentPeriodEnd, notes } = body

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

    const previousState = {
      plan: existing.plan, status: existing.status,
      trialStartsAt: existing.trialStartsAt, trialEndsAt: existing.trialEndsAt,
      currentPeriodStart: existing.currentPeriodStart, currentPeriodEnd: existing.currentPeriodEnd,
      canceledAt: existing.canceledAt, notes: existing.notes,
    }

    const updateData: Prisma.SubscriptionUpdateInput = {}
    const newStateRecord: Record<string, unknown> = {}

    if (plan !== undefined) { updateData.plan = plan; newStateRecord.plan = plan }
    if (status !== undefined) {
      updateData.status = status
      newStateRecord.status = status
      if (status === 'canceled' && !existing.canceledAt) { updateData.canceledAt = new Date(); newStateRecord.canceledAt = new Date().toISOString() }
      if (status !== 'canceled') { updateData.canceledAt = null; newStateRecord.canceledAt = null }
    }
    if (trialStartsAt !== undefined) {
      const v = trialStartsAt ? new Date(trialStartsAt) : null
      updateData.trialStartsAt = v; newStateRecord.trialStartsAt = v?.toISOString() ?? null
    }
    if (trialEndsAt !== undefined) {
      const v = trialEndsAt ? new Date(trialEndsAt) : null
      updateData.trialEndsAt = v; newStateRecord.trialEndsAt = v?.toISOString() ?? null
    }
    if (currentPeriodStart !== undefined) {
      const v = currentPeriodStart ? new Date(currentPeriodStart) : null
      updateData.currentPeriodStart = v; newStateRecord.currentPeriodStart = v?.toISOString() ?? null
    }
    if (currentPeriodEnd !== undefined) {
      const v = currentPeriodEnd ? new Date(currentPeriodEnd) : null
      updateData.currentPeriodEnd = v; newStateRecord.currentPeriodEnd = v?.toISOString() ?? null
    }
    if (notes !== undefined) { updateData.notes = notes || null; newStateRecord.notes = notes || null }

    const updated = await prisma.subscription.update({
      where: { organizationId: orgId },
      data: updateData,
    })

    const auditActions: string[] = []
    if (plan !== undefined && plan !== existing.plan) auditActions.push(BILLING_AUDIT_ACTIONS.PLAN_CHANGED)
    if (status !== undefined && status !== existing.status) {
      auditActions.push(BILLING_AUDIT_ACTIONS.STATUS_CHANGED)
      if (status === 'canceled') auditActions.push(BILLING_AUDIT_ACTIONS.CANCELED)
      if (status === 'active') auditActions.push(BILLING_AUDIT_ACTIONS.ACTIVATED)
    }
    const datesChanged =
      (trialStartsAt !== undefined && String(trialStartsAt ?? '') !== String(existing.trialStartsAt ?? '')) ||
      (trialEndsAt !== undefined && String(trialEndsAt ?? '') !== String(existing.trialEndsAt ?? '')) ||
      (currentPeriodStart !== undefined && String(currentPeriodStart ?? '') !== String(existing.currentPeriodStart ?? '')) ||
      (currentPeriodEnd !== undefined && String(currentPeriodEnd ?? '') !== String(existing.currentPeriodEnd ?? ''))
    if (datesChanged) auditActions.push(BILLING_AUDIT_ACTIONS.DATES_UPDATED)
    if (notes !== undefined && (notes || null) !== existing.notes) auditActions.push(BILLING_AUDIT_ACTIONS.NOTES_UPDATED)

    if (auditActions.length > 0) {
      await prisma.billingAuditLog.createMany({
        data: auditActions.map((action) => ({
          subscriptionId: existing.id,
          organizationId: orgId,
          actorEmail: userEmail ?? 'unknown',
          action,
          previousState: previousState as Prisma.InputJsonValue,
          newState: newStateRecord as Prisma.InputJsonValue,
        })),
      })
    }

    return NextResponse.json({ subscription: updated })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/subscriptions/[orgId]', action: 'PUT' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

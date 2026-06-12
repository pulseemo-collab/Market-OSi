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
    const [subscription, auditLogs, ownerRole] = await Promise.all([
      prisma.subscription.findUnique({ where: { organizationId: orgId } }),
      prisma.billingAuditLog.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.userRole.findFirst({
        where: { organizationId: orgId, roli: 'owner' },
        select: { email: true },
      }),
    ])

    return NextResponse.json({ subscription, auditLogs, ownerEmail: ownerRole?.email ?? null })
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

export async function POST(
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
    const { action } = body

    const existing = await prisma.subscription.findUnique({ where: { organizationId: orgId } })
    if (!existing) {
      return NextResponse.json({ error: 'Abonimi nuk u gjet' }, { status: 404 })
    }

    const now = new Date()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let updated: any
    let auditNotes: string
    let planChanged = false
    let statusChanged = false

    if (action === 'activate') {
      const { plan } = body
      if (!['monthly', 'yearly'].includes(plan)) {
        return NextResponse.json({ error: 'Plan i pavlefshëm' }, { status: 400 })
      }
      const base = (existing.currentPeriodEnd && existing.currentPeriodEnd > now)
        ? new Date(existing.currentPeriodEnd)
        : new Date(now)
      const end = new Date(base)
      if (plan === 'monthly') end.setMonth(end.getMonth() + 1)
      else end.setFullYear(end.getFullYear() + 1)

      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { plan, status: 'active', currentPeriodStart: base, currentPeriodEnd: end, nextPlan: null },
      })
      planChanged = existing.plan !== plan
      statusChanged = existing.status !== 'active'
      auditNotes = `Pagesa shënuar. Plan: ${plan}. Perioda: ${base.toLocaleDateString('sq-AL')} – ${end.toLocaleDateString('sq-AL')}`

    } else if (action === 'extend') {
      const { months } = body
      if (![1, 3, 6, 12].includes(months)) {
        return NextResponse.json({ error: 'Numër muajsh i pavlefshëm' }, { status: 400 })
      }
      const base = (existing.currentPeriodEnd && existing.currentPeriodEnd > now)
        ? new Date(existing.currentPeriodEnd)
        : new Date(now)
      const newEnd = new Date(base)
      newEnd.setMonth(newEnd.getMonth() + months)

      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { currentPeriodEnd: newEnd, status: 'active' },
      })
      statusChanged = existing.status !== 'active'
      auditNotes = `Abonimi u zgjat me ${months} muaj. Skadon: ${newEnd.toLocaleDateString('sq-AL')}`

    } else if (action === 'cancel') {
      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { status: 'cancelled' },
      })
      statusChanged = existing.status !== 'cancelled'
      auditNotes = 'Abonimi u anulua'

    } else if (action === 'reactivate') {
      const { plan } = body
      if (!['monthly', 'yearly'].includes(plan)) {
        return NextResponse.json({ error: 'Plan i pavlefshëm' }, { status: 400 })
      }
      if (!['cancelled', 'expired'].includes(existing.status)) {
        return NextResponse.json({ error: 'Abonimi nuk mund të riaktivizohet' }, { status: 400 })
      }
      const base = (existing.currentPeriodEnd && existing.currentPeriodEnd > now)
        ? new Date(existing.currentPeriodEnd)
        : new Date(now)
      const end = new Date(base)
      if (plan === 'monthly') end.setMonth(end.getMonth() + 1)
      else end.setFullYear(end.getFullYear() + 1)

      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { plan, status: 'active', currentPeriodStart: base, currentPeriodEnd: end },
      })
      planChanged = existing.plan !== plan
      statusChanged = true
      auditNotes = `Abonimi u riaktivizua. Plan: ${plan}. Perioda: ${base.toLocaleDateString('sq-AL')} – ${end.toLocaleDateString('sq-AL')}`

    } else if (action === 'setNextPlan') {
      const { nextPlan } = body
      if (!['monthly', 'yearly'].includes(nextPlan)) {
        return NextResponse.json({ error: 'Plan i ardhshëm i pavlefshëm' }, { status: 400 })
      }
      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { nextPlan },
      })
      auditNotes = `Plan i ardhshëm u caktua: ${nextPlan}`

    } else {
      return NextResponse.json({ error: 'Veprim i panjohur' }, { status: 400 })
    }

    await prisma.billingAuditLog.create({
      data: {
        organizationId: orgId,
        changedByUserId: userId ?? 'unknown',
        changedByEmail:  userEmail ?? 'unknown',
        oldPlan:   planChanged   ? existing.plan   : null,
        newPlan:   planChanged   ? updated.plan     : null,
        oldStatus: statusChanged ? existing.status  : null,
        newStatus: statusChanged ? updated.status   : null,
        notes:     auditNotes,
      },
    })

    return NextResponse.json({ subscription: updated, message: 'Veprimi u krye me sukses' })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/subscriptions/[orgId]', action: 'POST' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

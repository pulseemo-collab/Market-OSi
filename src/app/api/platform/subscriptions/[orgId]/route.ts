import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { isValidPlan, isValidStatus } from '@/lib/billing'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { PLATFORM_TAG, invalidateTags } from '@/lib/cache'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { orgId: string } }

async function handleGet(req: NextRequest, { params }: RouteContext) {
  const { userId, organizationId, error } = await requirePermission('billing:read')
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
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
        where: { organizationId: orgId, roli: 'Administrator' },
        select: { email: true },
      }),
    ])

    return NextResponse.json({ subscription, auditLogs, ownerEmail: ownerRole?.email ?? null })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/subscriptions/[orgId]', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handlePut(req: NextRequest, { params }: RouteContext) {
  const { userId, userEmail, organizationId, error } = await requirePermission('billing:manage')
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
  }

  try {
    const body = await req.json()
    const { plan, status, trialEndsAt, currentPeriodStart, currentPeriodEnd, notes } = body

    if (plan !== undefined && !isValidPlan(plan)) {
      return errorResponse(req, 'Plan i pavlefshëm', 400)
    }
    if (status !== undefined && !isValidStatus(status)) {
      return errorResponse(req, 'Status i pavlefshëm', 400)
    }

    const existing = await prisma.subscription.findUnique({ where: { organizationId: orgId } })
    if (!existing) {
      return errorResponse(req, 'Abonimi nuk u gjet', 404)
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

    // The subscription row itself is evicted by the Prisma write hook; the
    // cross-tenant platform statistics need an explicit nudge.
    invalidateTags(PLATFORM_TAG)

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
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handlePost(req: NextRequest, { params }: RouteContext) {
  const { userId, userEmail, organizationId, error } = await requirePermission('billing:manage')
  if (error) return error

  const rl = rateLimit(req, 'billing', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
  }

  try {
    const body = await req.json()
    const { action } = body

    const existing = await prisma.subscription.findUnique({ where: { organizationId: orgId } })
    if (!existing) {
      return errorResponse(req, 'Abonimi nuk u gjet', 404)
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
        return errorResponse(req, 'Plan i pavlefshëm', 400)
      }
      const base = (existing.currentPeriodEnd && existing.currentPeriodEnd > now)
        ? new Date(existing.currentPeriodEnd)
        : new Date(now)
      const end = new Date(base)
      if (plan === 'monthly') end.setMonth(end.getMonth() + 1)
      else end.setFullYear(end.getFullYear() + 1)

      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { plan, status: 'active', currentPeriodStart: base, currentPeriodEnd: end, nextPlan: null, cancelAtPeriodEnd: false, cancelledAt: null },
      })
      planChanged = existing.plan !== plan
      statusChanged = existing.status !== 'active'
      auditNotes = `Pagesa shënuar. Plan: ${plan}. Perioda: ${base.toLocaleDateString('sq-AL')} – ${end.toLocaleDateString('sq-AL')}`

    } else if (action === 'extend') {
      const years  = Math.floor(Number(body.years)  || 0)
      const months = Math.floor(Number(body.months) || 0)
      if (years < 0 || months < 0) {
        return errorResponse(req, 'Vlerat duhet të jenë pozitive', 400)
      }
      if (years === 0 && months === 0) {
        return errorResponse(req, 'Të paktën një fushë duhet të jetë më e madhe se 0', 400)
      }

      const base = (existing.currentPeriodEnd && existing.currentPeriodEnd > now)
        ? new Date(existing.currentPeriodEnd)
        : new Date(now)
      const newEnd = new Date(base)
      if (years  > 0) newEnd.setFullYear(newEnd.getFullYear() + years)
      if (months > 0) newEnd.setMonth(newEnd.getMonth() + months)

      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { currentPeriodEnd: newEnd, status: 'active', cancelAtPeriodEnd: false, cancelledAt: null },
      })
      statusChanged = existing.status !== 'active'
      const parts: string[] = []
      if (years  > 0) parts.push(`${years} ${years === 1 ? 'vit' : 'vite'}`)
      if (months > 0) parts.push(`${months} muaj`)
      auditNotes = `Abonimi u zgjat me ${parts.join(' dhe ')}. Skadon: ${newEnd.toLocaleDateString('sq-AL')}`

    } else if (action === 'cancel') {
      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { status: 'cancelled', cancelledAt: now, cancelAtPeriodEnd: false },
      })
      statusChanged = existing.status !== 'cancelled'
      auditNotes = 'Abonimi u anulua (nga platforma)'

    } else if (action === 'undoCancel') {
      if (!existing.cancelAtPeriodEnd) {
        return errorResponse(req, 'Nuk ka anulim të planifikuar', 400)
      }
      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { cancelAtPeriodEnd: false, cancelledAt: null },
      })
      auditNotes = 'Anulimi i planifikuar u hoq (nga platforma)'

    } else if (action === 'reactivate') {
      const { plan } = body
      if (!['monthly', 'yearly'].includes(plan)) {
        return errorResponse(req, 'Plan i pavlefshëm', 400)
      }
      if (!['cancelled', 'expired'].includes(existing.status)) {
        return errorResponse(req, 'Abonimi nuk mund të riaktivizohet', 400)
      }
      const base = (existing.currentPeriodEnd && existing.currentPeriodEnd > now)
        ? new Date(existing.currentPeriodEnd)
        : new Date(now)
      const end = new Date(base)
      if (plan === 'monthly') end.setMonth(end.getMonth() + 1)
      else end.setFullYear(end.getFullYear() + 1)

      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { plan, status: 'active', currentPeriodStart: base, currentPeriodEnd: end, cancelAtPeriodEnd: false, cancelledAt: null },
      })
      planChanged = existing.plan !== plan
      statusChanged = true
      auditNotes = `Abonimi u riaktivizua. Plan: ${plan}. Perioda: ${base.toLocaleDateString('sq-AL')} – ${end.toLocaleDateString('sq-AL')}`

    } else if (action === 'setNextPlan') {
      const { nextPlan } = body
      if (!['monthly', 'yearly'].includes(nextPlan)) {
        return errorResponse(req, 'Plan i ardhshëm i pavlefshëm', 400)
      }
      updated = await prisma.subscription.update({
        where: { organizationId: orgId },
        data: { nextPlan },
      })
      auditNotes = `Plan i ardhshëm u caktua: ${nextPlan}`

    } else {
      return errorResponse(req, 'Veprim i panjohur', 400)
    }

    invalidateTags(PLATFORM_TAG)

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
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute<RouteContext>('/api/platform/subscriptions/[orgId]', handleGet)
export const PUT = instrumentRoute<RouteContext>('/api/platform/subscriptions/[orgId]', handlePut)
export const POST = instrumentRoute<RouteContext>('/api/platform/subscriptions/[orgId]', handlePost)

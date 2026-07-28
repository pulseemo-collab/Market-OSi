import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { hashPin } from '@/lib/staff-auth'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'

type RouteContext = { params: { id: string } }

async function handlePost(req: NextRequest, { params }: RouteContext) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['Administrator', 'Manager'])
  if (error) return error

  const rl = rateLimit(req, 'staff', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  const staffId = parseInt(params.id)
  if (isNaN(staffId)) return errorResponse(req, 'ID e pavlefshme', 400)

  try {
    const existing = await prisma.staff.findFirst({
      where: { id: staffId, organizationId: organizationId! },
    })
    if (!existing) return errorResponse(req, 'Stafi nuk u gjet', 404)

    const { pin } = await req.json()
    if (!pin || !/^\d{4,6}$/.test(String(pin))) {
      return errorResponse(req, 'PIN duhet të jetë 4-6 shifra', 400)
    }

    const pinHash = await hashPin(String(pin))

    await prisma.staff.update({
      where: { id: staffId },
      data: { pinHash, failedAttempts: 0, lockedUntil: null },
    })

    // Invalidate all active sessions — re-login required after PIN change
    await prisma.staffSession.deleteMany({ where: { staffId } })

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.STAFF_PIN_CHANGED,
      entityType: AUDIT_ENTITY_TYPES.STAFF,
      entityId: staffId,
      description: `PIN-i i stafit "${existing.emri}" u ndryshua`,
      metadata: null,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    captureApiError(err, { organizationId, route: `/api/staff/${staffId}/pin`, action: 'POST' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const POST = instrumentRoute<RouteContext>('/api/staff/[id]/pin', handlePost)

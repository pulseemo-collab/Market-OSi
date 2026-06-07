import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { hashPin } from '@/lib/staff-auth'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['owner', 'manager'])
  if (error) return error

  const rl = rateLimit(req, 'staff', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

  const staffId = parseInt(params.id)
  if (isNaN(staffId)) return NextResponse.json({ error: 'ID e pavlefshme' }, { status: 400 })

  try {
    const existing = await prisma.staff.findFirst({
      where: { id: staffId, organizationId: organizationId! },
    })
    if (!existing) return NextResponse.json({ error: 'Stafi nuk u gjet' }, { status: 404 })

    const { pin } = await req.json()
    if (!pin || !/^\d{4,6}$/.test(String(pin))) {
      return NextResponse.json({ error: 'PIN duhet të jetë 4-6 shifra' }, { status: 400 })
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
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

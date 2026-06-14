import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['Administrator', 'Manager'])
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

    const body = await req.json()
    const { emri, roli, isActive, kodi } = body

    if (roli !== undefined && !['Cashier'].includes(roli)) {
      return NextResponse.json({ error: 'Roli i pavlefshëm' }, { status: 400 })
    }

    if (kodi !== undefined && kodi !== null && kodi !== '') {
      const conflict = await prisma.staff.findFirst({
        where: {
          organizationId: organizationId!,
          kodi: kodi.trim(),
          NOT: { id: staffId },
        },
      })
      if (conflict) return NextResponse.json({ error: 'Kodi ekziston tashmë' }, { status: 409 })
    }

    const updated = await prisma.staff.update({
      where: { id: staffId },
      data: {
        ...(emri !== undefined && { emri: emri.trim() }),
        ...(roli !== undefined && { roli }),
        ...(typeof isActive === 'boolean' && { isActive }),
        ...(kodi !== undefined && { kodi: kodi?.trim() || null }),
      },
    })

    const wasDeactivated = typeof isActive === 'boolean' && !isActive && existing.isActive
    const wasActivated = typeof isActive === 'boolean' && isActive && !existing.isActive

    if (wasDeactivated) {
      await prisma.staffSession.deleteMany({ where: { staffId } })
      await logAuditAction({
        userId: userId!,
        userEmail: userEmail!,
        userRole: role!,
        organizationId: organizationId!,
        action: AUDIT_ACTIONS.STAFF_DEACTIVATED,
        entityType: AUDIT_ENTITY_TYPES.STAFF,
        entityId: staffId,
        description: `Stafi "${existing.emri}" u çaktivizua`,
        metadata: null,
      })
    } else if (wasActivated) {
      await logAuditAction({
        userId: userId!,
        userEmail: userEmail!,
        userRole: role!,
        organizationId: organizationId!,
        action: AUDIT_ACTIONS.STAFF_ACTIVATED,
        entityType: AUDIT_ENTITY_TYPES.STAFF,
        entityId: staffId,
        description: `Stafi "${existing.emri}" u aktivizua`,
        metadata: null,
      })
    } else {
      await logAuditAction({
        userId: userId!,
        userEmail: userEmail!,
        userRole: role!,
        organizationId: organizationId!,
        action: AUDIT_ACTIONS.UPDATE,
        entityType: AUDIT_ENTITY_TYPES.STAFF,
        entityId: staffId,
        description: `Të dhënat e stafit "${existing.emri}" u përditësuan`,
        metadata: { emri, roli, kodi },
      })
    }

    return NextResponse.json({
      id: updated.id,
      emri: updated.emri,
      kodi: updated.kodi,
      roli: updated.roli,
      isActive: updated.isActive,
    })
  } catch (err) {
    captureApiError(err, { organizationId, route: `/api/staff/${staffId}`, action: 'PATCH' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['Administrator', 'Manager'])
  if (error) return error

  const staffId = parseInt(params.id)
  if (isNaN(staffId)) return NextResponse.json({ error: 'ID e pavlefshme' }, { status: 400 })

  try {
    const existing = await prisma.staff.findFirst({
      where: { id: staffId, organizationId: organizationId! },
    })
    if (!existing) return NextResponse.json({ error: 'Stafi nuk u gjet' }, { status: 404 })

    // Invalidate all sessions
    await prisma.staffSession.deleteMany({ where: { staffId } })

    // Soft-delete: deactivate rather than hard delete to preserve sales records
    await prisma.staff.update({ where: { id: staffId }, data: { isActive: false } })

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.STAFF_DEACTIVATED,
      entityType: AUDIT_ENTITY_TYPES.STAFF,
      entityId: staffId,
      description: `Stafi "${existing.emri}" u çaktivizua dhe u fshi`,
      metadata: null,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    captureApiError(err, { organizationId, route: `/api/staff/${staffId}`, action: 'DELETE' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

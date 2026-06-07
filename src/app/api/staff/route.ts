import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { hashPin } from '@/lib/staff-auth'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'

export async function GET(req: NextRequest) {
  const { userId, role, organizationId, error } = await requireRole(['owner', 'manager'])
  if (error) return error

  const rl = rateLimit(req, 'staff', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

  try {
    const staff = await prisma.staff.findMany({
      where: { organizationId: organizationId! },
      select: {
        id: true,
        emri: true,
        kodi: true,
        roli: true,
        isActive: true,
        failedAttempts: true,
        lockedUntil: true,
        createdAt: true,
      },
      orderBy: [{ isActive: 'desc' }, { emri: 'asc' }],
    })
    return NextResponse.json(staff)
  } catch (err) {
    captureApiError(err, { organizationId, route: '/api/staff', action: 'GET' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['owner', 'manager'])
  if (error) return error

  const rl = rateLimit(req, 'staff', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

  try {
    const { emri, kodi, roli, pin } = await req.json()

    if (!emri?.trim() || !roli || !pin) {
      return NextResponse.json({ error: 'Fushat e detyrueshme mungojnë' }, { status: 400 })
    }

    if (!['cashier', 'employee'].includes(roli)) {
      return NextResponse.json({ error: 'Roli i pavlefshëm' }, { status: 400 })
    }

    if (!/^\d{4,6}$/.test(String(pin))) {
      return NextResponse.json({ error: 'PIN duhet të jetë 4-6 shifra' }, { status: 400 })
    }

    if (kodi?.trim()) {
      const existing = await prisma.staff.findUnique({
        where: { organizationId_kodi: { organizationId: organizationId!, kodi: kodi.trim() } },
      })
      if (existing) {
        return NextResponse.json({ error: 'Kodi ekziston tashmë' }, { status: 409 })
      }
    }

    const pinHash = await hashPin(String(pin))

    const staff = await prisma.staff.create({
      data: {
        emri: emri.trim(),
        kodi: kodi?.trim() || null,
        roli,
        pinHash,
        organizationId: organizationId!,
      },
    })

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.STAFF_CREATED,
      entityType: AUDIT_ENTITY_TYPES.STAFF,
      entityId: staff.id,
      description: `Stafi "${staff.emri}" u krijua me rol ${staff.roli}`,
      metadata: { roli: staff.roli, kodi: staff.kodi },
    })

    return NextResponse.json(
      { id: staff.id, emri: staff.emri, kodi: staff.kodi, roli: staff.roli, isActive: staff.isActive },
      { status: 201 },
    )
  } catch (err) {
    captureApiError(err, { organizationId, route: '/api/staff', action: 'POST' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

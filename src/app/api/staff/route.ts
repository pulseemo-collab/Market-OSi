import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'
import { hashPin } from '@/lib/staff-auth'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { withIdempotency } from '@/lib/idempotency'

async function handleGet(req: NextRequest) {
  const { userId, role, organizationId, error } = await requireRole(['Administrator', 'Manager'])
  if (error) return error

  const rl = rateLimit(req, 'staff', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

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
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handlePost(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requireRole(['Administrator', 'Manager'])
  if (error) return error

  const rl = rateLimit(req, 'staff', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  return withIdempotency(
    req,
    { route: 'POST /api/staff', organizationId: organizationId!, userId: userId! },
    () => createStaff(req, userId!, userEmail!, role!, organizationId!),
  )
}

async function createStaff(
  req: NextRequest,
  userId: string,
  userEmail: string,
  role: string,
  organizationId: number,
) {
  try {
    const { emri, kodi, roli, pin } = await req.json()

    if (!emri?.trim() || !roli || !pin) {
      return errorResponse(req, 'Fushat e detyrueshme mungojnë', 400)
    }

    if (!['Cashier'].includes(roli)) {
      return errorResponse(req, 'Roli i pavlefshëm', 400)
    }

    if (!/^\d{4,6}$/.test(String(pin))) {
      return errorResponse(req, 'PIN duhet të jetë 4-6 shifra', 400)
    }

    if (kodi?.trim()) {
      const existing = await prisma.staff.findUnique({
        where: { organizationId_kodi: { organizationId, kodi: kodi.trim() } },
      })
      if (existing) {
        return errorResponse(req, 'Kodi ekziston tashmë', 409)
      }
    }

    const pinHash = await hashPin(String(pin))

    const staff = await prisma.staff.create({
      data: {
        emri: emri.trim(),
        kodi: kodi?.trim() || null,
        roli,
        pinHash,
        organizationId,
      },
    })

    await logAuditAction({
      userId,
      userEmail,
      userRole: role,
      organizationId,
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
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/staff', handleGet)
export const POST = instrumentRoute('/api/staff', handlePost)

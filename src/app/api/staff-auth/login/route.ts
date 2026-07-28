import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  verifyPin,
  createStaffSession,
  setStaffSessionCookie,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
} from '@/lib/staff-auth'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'

async function handlePost(req: NextRequest) {
  const rl = rateLimit(req, 'staff-auth', null, null)
  if (rl.limited) return rl.response!

  try {
    const body = await req.json()
    const { emri, pin } = body

    if (!emri || !pin) {
      return errorResponse(req, 'Të dhënat mungojnë', 400)
    }

    const pinStr = String(pin)
    if (pinStr.length < 4 || pinStr.length > 20) {
      return errorResponse(req, 'PIN duhet të jetë 4-20 karaktere', 400)
    }

    const staffMatches = await prisma.staff.findMany({
      where: {
        emri: { equals: String(emri).trim(), mode: 'insensitive' },
        isActive: true,
      },
    })

    if (staffMatches.length > 1) {
      return errorResponse(req, 'Ka më shumë se një punonjës me këtë emër. Kontaktoni menaxherin.', 409)
    }

    if (staffMatches.length === 0) {
      return errorResponse(req, 'Stafi nuk u gjet', 404)
    }

    const staff = staffMatches[0]

    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((staff.lockedUntil.getTime() - Date.now()) / 60000)
      return errorResponse(req, `Llogaria është e bllokuar. Provo pas ${minutesLeft} minutash.`, 429)
    }

    const valid = await verifyPin(pinStr, staff.pinHash)

    if (!valid) {
      const newAttempts = staff.failedAttempts + 1
      const shouldLock = newAttempts >= MAX_FAILED_ATTEMPTS

      await prisma.staff.update({
        where: { id: staff.id },
        data: {
          failedAttempts: newAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
        },
      })

      await logAuditAction({
        userId: `staff:${staff.id}`,
        userEmail: staff.emri,
        userRole: staff.roli,
        organizationId: staff.organizationId,
        action: shouldLock ? AUDIT_ACTIONS.STAFF_LOCKED : AUDIT_ACTIONS.STAFF_LOGIN_FAILED,
        entityType: AUDIT_ENTITY_TYPES.STAFF,
        entityId: staff.id,
        description: shouldLock
          ? `Stafi "${staff.emri}" u bllokua pas ${MAX_FAILED_ATTEMPTS} përpjekjeve të dështuara`
          : `Hyrje e dështuar për stafin "${staff.emri}" (${newAttempts}/${MAX_FAILED_ATTEMPTS})`,
        metadata: { failedAttempts: newAttempts, locked: shouldLock },
      })

      if (shouldLock) {
        return errorResponse(req, `PIN i gabuar. Llogaria u bllokua për ${LOCKOUT_MINUTES} minuta.`, 429)
      }

      const remaining = MAX_FAILED_ATTEMPTS - newAttempts
      return errorResponse(req, `PIN i gabuar. ${remaining} përpjekje të mbetura.`, 401)
    }

    await prisma.staff.update({
      where: { id: staff.id },
      data: { failedAttempts: 0, lockedUntil: null },
    })

    // organizationId comes from DB — never trusted from the client
    let token: string
    try {
      token = await createStaffSession(staff.id, staff.organizationId)
    } catch (sessionError) {
      captureApiError(sessionError, { route: '/api/staff-auth/login', action: 'POST' })
      return errorResponse(req, 'Sesioni nuk u krijua. Provoni përsëri.', 500)
    }

    await logAuditAction({
      userId: `staff:${staff.id}`,
      userEmail: staff.emri,
      userRole: staff.roli,
      organizationId: staff.organizationId,
      action: AUDIT_ACTIONS.STAFF_LOGIN,
      entityType: AUDIT_ENTITY_TYPES.STAFF,
      entityId: staff.id,
      description: `Stafi "${staff.emri}" u identifikua me PIN`,
      metadata: { role: staff.roli },
    })

    const res = NextResponse.json({
      success: true,
      staffId: staff.id,
      staffName: staff.emri,
      staffRole: staff.roli,
    })

    setStaffSessionCookie(res, token)
    return res
  } catch (error) {
    captureApiError(error, { route: '/api/staff-auth/login', action: 'POST' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const POST = instrumentRoute('/api/staff-auth/login', handlePost)

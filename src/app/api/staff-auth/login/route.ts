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

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 'staff-auth', null, null)
  if (rl.limited) return rl.response!

  try {
    const body = await req.json()
    const { emri, pin } = body

    if (!emri || !pin) {
      return NextResponse.json({ error: 'Të dhënat mungojnë' }, { status: 400 })
    }

    const pinStr = String(pin)
    if (pinStr.length < 4 || pinStr.length > 20) {
      return NextResponse.json({ error: 'PIN duhet të jetë 4-20 karaktere' }, { status: 400 })
    }

    const staffMatches = await prisma.staff.findMany({
      where: {
        emri: { equals: String(emri).trim(), mode: 'insensitive' },
        isActive: true,
      },
    })

    if (staffMatches.length > 1) {
      return NextResponse.json(
        { error: 'Ka më shumë se një punonjës me këtë emër. Kontaktoni menaxherin.' },
        { status: 409 },
      )
    }

    if (staffMatches.length === 0) {
      return NextResponse.json({ error: 'Stafi nuk u gjet' }, { status: 404 })
    }

    const staff = staffMatches[0]

    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((staff.lockedUntil.getTime() - Date.now()) / 60000)
      return NextResponse.json(
        { error: `Llogaria është e bllokuar. Provo pas ${minutesLeft} minutash.` },
        { status: 429 },
      )
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
        return NextResponse.json(
          { error: `PIN i gabuar. Llogaria u bllokua për ${LOCKOUT_MINUTES} minuta.` },
          { status: 429 },
        )
      }

      const remaining = MAX_FAILED_ATTEMPTS - newAttempts
      return NextResponse.json(
        { error: `PIN i gabuar. ${remaining} përpjekje të mbetura.` },
        { status: 401 },
      )
    }

    await prisma.staff.update({
      where: { id: staff.id },
      data: { failedAttempts: 0, lockedUntil: null },
    })

    // organizationId comes from DB — never trusted from the client
    const token = await createStaffSession(staff.id, staff.organizationId)

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
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

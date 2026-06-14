import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'
import { scrypt, randomBytes, timingSafeEqual } from 'crypto'
import { promisify } from 'util'

const scryptAsync = promisify(scrypt)

export const STAFF_SESSION_COOKIE = 'staff_session'
export const TERMINAL_ORG_COOKIE = 'pos_terminal_org'
export const MANAGER_ORG_COOKIE = 'manager_org_ctx'
const SESSION_DURATION_HOURS = 8
export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scryptAsync(pin, salt, 64)) as Buffer
  return `${salt}:${hash.toString('hex')}`
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  try {
    const [salt, hashHex] = stored.split(':')
    if (!salt || !hashHex) return false
    const hashBuffer = Buffer.from(hashHex, 'hex')
    const derived = (await scryptAsync(pin, salt, 64)) as Buffer
    return timingSafeEqual(derived, hashBuffer)
  } catch {
    return false
  }
}

export interface StaffSessionData {
  sessionId: number
  staffId: number
  staffName: string
  staffRole: string
  organizationId: number
  expiresAt: Date
}

export async function getStaffSession(req: NextRequest): Promise<StaffSessionData | null> {
  try {
    const token = req.cookies.get(STAFF_SESSION_COOKIE)?.value
    if (!token) return null

    const session = await prisma.staffSession.findUnique({
      where: { token },
      include: { staff: true },
    })

    if (!session) return null
    if (session.expiresAt < new Date()) {
      await prisma.staffSession.delete({ where: { id: session.id } }).catch(() => {})
      return null
    }
    if (!session.staff.isActive) return null

    // roli may be null on older rows created before the NOT NULL constraint was enforced;
    // fall back to the schema default so sessions remain usable.
    const staffRole = session.staff.roli ?? 'Cashier'

    return {
      sessionId: session.id,
      staffId: session.staffId,
      staffName: session.staff.emri,
      staffRole,
      organizationId: session.organizationId,
      expiresAt: session.expiresAt,
    }
  } catch {
    return null
  }
}

export async function createStaffSession(staffId: number, organizationId: number): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000)

  // Remove previous sessions for this staff member (one active session at a time)
  await prisma.staffSession.deleteMany({ where: { staffId } }).catch(() => {})

  await prisma.staffSession.create({
    data: { token, staffId, organizationId, expiresAt },
  })

  return token
}

export function setStaffSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(STAFF_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION_HOURS * 60 * 60,
    path: '/',
  })
}

export function clearStaffSessionCookie(res: NextResponse): void {
  res.cookies.set(STAFF_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
}

export function setManagerOrgCookie(res: NextResponse, orgId: number): void {
  res.cookies.set(MANAGER_ORG_COOKIE, String(orgId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60,
    path: '/',
  })
}

export function setTerminalOrgCookie(res: NextResponse, orgId: number): void {
  res.cookies.set(TERMINAL_ORG_COOKIE, String(orgId), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60,
    path: '/',
  })
}

/** Dual-auth helper: tries staff session after a failed Supabase permission check. */
export async function resolveStaffAuth(
  req: NextRequest,
  allowedRoles: string[] = ['Cashier'],
): Promise<{
  isStaffAuth: boolean
  userId: string
  userEmail: string
  staffRole: string
  organizationId: number
  staffId: number
  staffName: string
  error: null
} | {
  isStaffAuth: false
  error: NextResponse
}> {
  const session = await getStaffSession(req)

  if (!session) {
    return { isStaffAuth: false, error: NextResponse.json({ error: 'Nuk je i autorizuar' }, { status: 401 }) }
  }

  if (!allowedRoles.includes(session.staffRole)) {
    return { isStaffAuth: false, error: NextResponse.json({ error: 'Nuk ke akses' }, { status: 403 }) }
  }

  return {
    isStaffAuth: true,
    userId: `staff:${session.staffId}`,
    userEmail: session.staffName,
    staffRole: session.staffRole,
    organizationId: session.organizationId,
    staffId: session.staffId,
    staffName: session.staffName,
    error: null,
  }
}

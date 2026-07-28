import { createClient } from './supabase/server'
import { prisma } from './prisma'
import { NextResponse } from 'next/server'
import { Role, LEGACY_ROLE_MAP, hasPermission } from './roles'
import { headers } from 'next/headers'

function getRequestId(): string {
  try {
    return headers().get('x-request-id') ?? crypto.randomUUID()
  } catch {
    return crypto.randomUUID()
  }
}

export async function getAuthUserAndRole(): Promise<{
  userId: string | null
  userEmail: string | null
  role: Role | null
  organizationId: number | null
  error: NextResponse | null
}> {
  const requestId = getRequestId()
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return {
        userId: null,
        userEmail: null,
        role: null,
        organizationId: null,
        error: NextResponse.json(
          { error: 'Nuk je i autorizuar', requestId },
          { status: 401, headers: { 'X-Request-Id': requestId } },
        ),
      }
    }

    const userRole = await prisma.userRole.findUnique({ where: { userId: user.id } })
    if (!userRole) {
      return {
        userId: null,
        userEmail: null,
        role: null,
        organizationId: null,
        error: NextResponse.json(
          { error: 'Nuk je i autorizuar', requestId },
          { status: 401, headers: { 'X-Request-Id': requestId } },
        ),
      }
    }

    const rawRole = userRole.roli ?? 'Cashier'
    const role = (LEGACY_ROLE_MAP[rawRole] ?? rawRole) as Role

    return { userId: user.id, userEmail: userRole.email, role, organizationId: userRole.organizationId, error: null }
  } catch {
    return {
      userId: null,
      userEmail: null,
      role: null,
      organizationId: null,
      error: NextResponse.json(
        { error: 'Gabim në server', requestId },
        { status: 500, headers: { 'X-Request-Id': requestId } },
      ),
    }
  }
}

export async function requireRole(allowedRoles: Role[]): Promise<{
  userId: string | null
  userEmail: string | null
  role: Role | null
  organizationId: number | null
  error: NextResponse | null
}> {
  const result = await getAuthUserAndRole()
  if (result.error) return result

  if (!result.role || !allowedRoles.includes(result.role)) {
    const requestId = getRequestId()
    return {
      userId: result.userId,
      userEmail: result.userEmail,
      role: result.role,
      organizationId: result.organizationId,
      error: NextResponse.json(
        { error: 'Nuk ke akses', requestId },
        { status: 403, headers: { 'X-Request-Id': requestId } },
      ),
    }
  }

  return result
}

export async function requirePermission(permission: string): Promise<{
  userId: string | null
  userEmail: string | null
  role: Role | null
  organizationId: number | null
  error: NextResponse | null
}> {
  const result = await getAuthUserAndRole()
  if (result.error) return result

  if (!hasPermission(result.role, permission)) {
    const requestId = getRequestId()
    return {
      userId: result.userId,
      userEmail: result.userEmail,
      role: result.role,
      organizationId: result.organizationId,
      error: NextResponse.json(
        { error: 'Nuk ke akses', requestId },
        { status: 403, headers: { 'X-Request-Id': requestId } },
      ),
    }
  }

  return result
}

export async function getCurrentOrganization(): Promise<{
  organizationId: number | null
  error: NextResponse | null
}> {
  const result = await getAuthUserAndRole()
  if (result.error) return { organizationId: null, error: result.error }

  if (!result.organizationId) {
    const requestId = getRequestId()
    return {
      organizationId: null,
      error: NextResponse.json(
        { error: 'Organizata nuk u gjet', requestId },
        { status: 401, headers: { 'X-Request-Id': requestId } },
      ),
    }
  }

  return { organizationId: result.organizationId, error: null }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { Role, ROLE_LABELS } from '@/lib/roles'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import { errorResponse, instrumentRoute } from '@/lib/logger'

type RouteContext = { params: { id: string } }

const VALID_ROLES: Role[] = ['Administrator', 'Manager', 'Cashier']

async function handlePut(req: NextRequest, { params }: RouteContext) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  const rl = rateLimit(req, 'auth', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const id = parseInt(params.id)
    if (isNaN(id)) {
      return errorResponse(req, 'ID i pavlefshëm', 400)
    }

    const body = await req.json()
    const { roli } = body

    if (!VALID_ROLES.includes(roli)) {
      return errorResponse(req, 'Rol i pavlefshëm', 400)
    }

    const targetUser = await prisma.userRole.findFirst({
      where: { id, organizationId: organizationId! },
    })
    if (!targetUser) {
      return errorResponse(req, 'Përdoruesi nuk u gjet', 404)
    }

    if (targetUser.userId === userId && roli !== 'Administrator') {
      return errorResponse(req, 'Nuk mund të ndryshosh rolin tënd', 403)
    }

    const oldRole = targetUser.roli as Role
    const userRole = await prisma.userRole.update({
      where: { id },
      data: { roli },
    })

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.CHANGE_ROLE,
      entityType: AUDIT_ENTITY_TYPES.USER,
      entityId: targetUser.userId,
      description: `Roli i "${targetUser.email}" u ndryshua nga "${ROLE_LABELS[oldRole] ?? oldRole}" në "${ROLE_LABELS[roli as Role] ?? roli}"`,
      metadata: { targetEmail: targetUser.email, oldRole, newRole: roli },
    })

    return NextResponse.json(userRole)
  } catch {
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const PUT = instrumentRoute<RouteContext>('/api/users/[id]', handlePut)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { Role, ROLE_LABELS } from '@/lib/roles'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'

const VALID_ROLES: Role[] = ['owner', 'manager', 'cashier', 'employee']

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  try {
    const id = parseInt(params.id)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
    }

    const body = await req.json()
    const { roli } = body

    if (!VALID_ROLES.includes(roli)) {
      return NextResponse.json({ error: 'Rol i pavlefshëm' }, { status: 400 })
    }

    const targetUser = await prisma.userRole.findFirst({
      where: { id, organizationId: organizationId! },
    })
    if (!targetUser) {
      return NextResponse.json({ error: 'Përdoruesi nuk u gjet' }, { status: 404 })
    }

    if (targetUser.userId === userId && roli !== 'owner') {
      return NextResponse.json(
        { error: 'Nuk mund të ndryshosh rolin tënd' },
        { status: 403 }
      )
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
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

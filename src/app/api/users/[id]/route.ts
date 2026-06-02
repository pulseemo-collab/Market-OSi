import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { Role } from '@/lib/roles'

const VALID_ROLES: Role[] = ['owner', 'manager', 'cashier', 'employee']

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, error } = await requirePermission('users:manage')
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

    const targetUser = await prisma.userRole.findUnique({ where: { id } })
    if (!targetUser) {
      return NextResponse.json({ error: 'Përdoruesi nuk u gjet' }, { status: 404 })
    }

    // Prevent self-demotion (owner cannot remove their own owner access)
    if (targetUser.userId === userId && roli !== 'owner') {
      return NextResponse.json(
        { error: 'Nuk mund të ndryshosh rolin tënd' },
        { status: 403 }
      )
    }

    const userRole = await prisma.userRole.update({
      where: { id },
      data: { roli },
    })

    return NextResponse.json(userRole)
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

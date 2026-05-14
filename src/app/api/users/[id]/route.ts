import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const id = parseInt(params.id)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
    }

    const body = await req.json()
    const { roli } = body

    if (!['admin', 'cashier', 'staff'].includes(roli)) {
      return NextResponse.json({ error: 'Rol i pavlefshëm' }, { status: 400 })
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

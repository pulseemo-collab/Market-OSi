import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'

export async function GET(req: NextRequest) {
  const { organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  try {
    const users = await prisma.userRole.findMany({
      where: { organizationId: organizationId! },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(users)
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

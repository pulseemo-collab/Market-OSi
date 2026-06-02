import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  const rl = rateLimit(req, 'auth', userId, organizationId)
  if (rl.limited) return rl.response!

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

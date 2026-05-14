import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/auth-helpers'

export async function GET(req: NextRequest) {
  const { error } = await requireRole(['admin'])
  if (error) return error

  try {
    const users = await prisma.userRole.findMany({
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(users)
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

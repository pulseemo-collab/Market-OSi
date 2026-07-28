import { NextRequest, NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-auth'
import { prisma } from '@/lib/prisma'
import { instrumentRoute } from '@/lib/logger'

async function handleGet(req: NextRequest) {
  const session = await getStaffSession(req)

  if (!session) {
    return NextResponse.json({ session: null })
  }

  const organization = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { name: true },
  })

  return NextResponse.json({
    session: {
      staffId: session.staffId,
      staffName: session.staffName,
      staffRole: session.staffRole,
      organizationId: session.organizationId,
      organizationName: organization?.name ?? null,
      expiresAt: session.expiresAt,
    },
  })
}

export const GET = instrumentRoute('/api/staff-auth/session', handleGet)

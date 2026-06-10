import { NextRequest, NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  console.log('[/api/staff-auth/session] GET — cookie header:', req.headers.get('cookie')?.substring(0, 80))
  const session = await getStaffSession(req)

  if (!session) {
    console.log('[/api/staff-auth/session] no valid session — returning null')
    return NextResponse.json({ session: null })
  }

  const organization = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { name: true },
  })

  console.log(`[/api/staff-auth/session] valid — staffRole=${session.staffRole} orgId=${session.organizationId} orgName=${organization?.name}`)
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

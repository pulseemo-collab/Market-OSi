import { NextRequest, NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-auth'

export async function GET(req: NextRequest) {
  const session = await getStaffSession(req)

  if (!session) {
    return NextResponse.json({ session: null })
  }

  return NextResponse.json({
    session: {
      staffId: session.staffId,
      staffName: session.staffName,
      staffRole: session.staffRole,
      organizationId: session.organizationId,
      expiresAt: session.expiresAt,
    },
  })
}

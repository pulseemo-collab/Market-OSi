import { NextRequest, NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-auth'

export async function GET(req: NextRequest) {
  console.log('[/api/staff-auth/session] GET — cookie header:', req.headers.get('cookie')?.substring(0, 80))
  const session = await getStaffSession(req)

  if (!session) {
    console.log('[/api/staff-auth/session] no valid session — returning null')
    return NextResponse.json({ session: null })
  }

  console.log(`[/api/staff-auth/session] valid — staffRole=${session.staffRole} orgId=${session.organizationId}`)
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

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStaffSession, clearStaffSessionCookie } from '@/lib/staff-auth'

export async function POST(req: NextRequest) {
  const session = await getStaffSession(req)

  if (session) {
    await prisma.staffSession.deleteMany({ where: { staffId: session.staffId } }).catch(() => {})
  }

  const res = NextResponse.json({ success: true })
  clearStaffSessionCookie(res)
  return res
}

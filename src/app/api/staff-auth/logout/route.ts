import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStaffSession, clearStaffSessionCookie } from '@/lib/staff-auth'
import { instrumentRoute } from '@/lib/logger'

async function handlePost(req: NextRequest) {
  const session = await getStaffSession(req)

  if (session) {
    await prisma.staffSession.deleteMany({ where: { staffId: session.staffId } }).catch(() => {})
  }

  const res = NextResponse.json({ success: true })
  clearStaffSessionCookie(res)
  return res
}

export const POST = instrumentRoute('/api/staff-auth/logout', handlePost)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { setManagerOrgCookie, getStaffSession } from '@/lib/staff-auth'

export async function GET(req: NextRequest) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const userRole = await prisma.userRole.findUnique({
      where: { userId: user.id },
      include: { organization: { select: { name: true, isActive: true } } },
    })

    if (!userRole) {
      return NextResponse.json({ error: 'UserRole missing' }, { status: 404 })
    }

    const organization = userRole.organization

    if (!organization.isActive) {
      return NextResponse.json({ error: 'Organizata nuk u gjet' }, { status: 404 })
    }

    if (userRole.roli === 'platform_owner') {
      return NextResponse.json({ organizationId: null })
    }

    const res = NextResponse.json({
      organizationId: userRole.organizationId,
      orgName: organization.name,
    })

    setManagerOrgCookie(res, userRole.organizationId)
    return res
  }

  // Try PIN staff session
  const staffSession = await getStaffSession(req)

  if (staffSession) {
    const organization = await prisma.organization.findUnique({
      where: { id: staffSession.organizationId },
      select: { name: true, isActive: true },
    })

    if (!organization || !organization.isActive) {
      return NextResponse.json({ error: 'Organizata nuk u gjet' }, { status: 404 })
    }
    return NextResponse.json({
      organizationId: staffSession.organizationId,
      orgName: organization.name,
    })
  }

  return NextResponse.json({ error: 'Nuk je i autorizuar' }, { status: 401 })
}

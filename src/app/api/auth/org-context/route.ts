import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { setManagerOrgCookie } from '@/lib/staff-auth'

export async function GET(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nuk je i autorizuar' }, { status: 401 })
  }

  const userRole = await prisma.userRole.findUnique({
    where: { userId: user.id },
    include: { organization: { select: { name: true, isActive: true } } },
  })

  if (!userRole || !userRole.organization.isActive) {
    return NextResponse.json({ error: 'Organizata nuk u gjet' }, { status: 404 })
  }

  // platform_owner has no org-level staff context
  if (userRole.roli === 'platform_owner') {
    return NextResponse.json({ organizationId: null })
  }

  const res = NextResponse.json({
    organizationId: userRole.organizationId,
    orgName: userRole.organization.name,
  })

  setManagerOrgCookie(res, userRole.organizationId)
  return res
}

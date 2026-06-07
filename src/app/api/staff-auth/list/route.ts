import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { TERMINAL_ORG_COOKIE, MANAGER_ORG_COOKIE } from '@/lib/staff-auth'

export async function GET(req: NextRequest) {
  const orgIdParam = req.nextUrl.searchParams.get('orgId')
  const terminalOrgCookie = req.cookies.get(TERMINAL_ORG_COOKIE)?.value
  const managerOrgCookie = req.cookies.get(MANAGER_ORG_COOKIE)?.value

  const orgIdStr = orgIdParam ?? terminalOrgCookie ?? managerOrgCookie
  if (!orgIdStr) {
    return NextResponse.json({ error: 'no_org_context' }, { status: 400 })
  }

  const organizationId = parseInt(orgIdStr)
  if (isNaN(organizationId)) {
    return NextResponse.json({ error: 'organizationId i pavlefshëm' }, { status: 400 })
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, isActive: true },
    })

    if (!org || !org.isActive) {
      return NextResponse.json({ error: 'Organizata nuk u gjet' }, { status: 404 })
    }

    const staff = await prisma.staff.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, emri: true, roli: true, kodi: true },
      orderBy: { emri: 'asc' },
    })

    return NextResponse.json({ staff, orgName: org.name, organizationId })
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

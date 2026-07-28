import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { TERMINAL_ORG_COOKIE, MANAGER_ORG_COOKIE } from '@/lib/staff-auth'
import { rateLimit } from '@/lib/rate-limit'
import { errorResponse, instrumentRoute } from '@/lib/logger'

async function handleGet(req: NextRequest) {
  const rl = rateLimit(req, 'staff-auth', null, null)
  if (rl.limited) return rl.response!
  const orgIdParam = req.nextUrl.searchParams.get('orgId')
  const terminalOrgCookie = req.cookies.get(TERMINAL_ORG_COOKIE)?.value
  const managerOrgCookie = req.cookies.get(MANAGER_ORG_COOKIE)?.value

  const orgIdStr = orgIdParam ?? terminalOrgCookie ?? managerOrgCookie
  if (!orgIdStr) {
    return errorResponse(req, 'no_org_context', 400)
  }

  const organizationId = parseInt(orgIdStr)
  if (isNaN(organizationId)) {
    return errorResponse(req, 'organizationId i pavlefshëm', 400)
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, isActive: true },
    })

    if (!org || !org.isActive) {
      return errorResponse(req, 'Organizata nuk u gjet', 404)
    }

    const staff = await prisma.staff.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, emri: true, roli: true, kodi: true },
      orderBy: { emri: 'asc' },
    })

    return NextResponse.json({ staff, orgName: org.name, organizationId })
  } catch {
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/staff-auth/list', handleGet)

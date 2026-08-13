import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOrgContext } from '@/lib/staff-auth'
import { rateLimit } from '@/lib/rate-limit'
import { errorResponse, instrumentRoute } from '@/lib/logger'

async function handleGet(req: NextRequest) {
  const rl = rateLimit(req, 'staff-auth', null, null)
  if (rl.limited) return rl.response!
  // The directory is bound to the organization this device was provisioned
  // for. It previously honoured an `orgId` query parameter, which let anyone
  // walk sequential ids and read any market's name and staff roster without
  // credentials — the same disclosure that made cross-tenant login collisions
  // exploitable rather than merely accidental.
  const organizationId = getOrgContext(req)
  if (organizationId === null) {
    return errorResponse(req, 'no_org_context', 400)
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

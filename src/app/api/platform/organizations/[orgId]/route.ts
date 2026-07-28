import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { PLATFORM_TAG, invalidateTags, orgScopeTag } from '@/lib/cache'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { orgId: string } }

async function handlePatch(req: NextRequest, { params }: RouteContext) {
  const { userId, organizationId, error } = await requirePermission('organizations:manage')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
  }

  try {
    const org = await prisma.organization.findUnique({ where: { id: orgId } })
    if (!org) {
      return errorResponse(req, 'Organizata nuk u gjet', 404)
    }

    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: { isActive: !org.isActive },
    })

    // Suspending or reinstating a tenant affects everything cached for it, so
    // this is the one place a whole-org eviction is the correct scope.
    invalidateTags(orgScopeTag(orgId), PLATFORM_TAG)

    return NextResponse.json({ organization: updated })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations/[orgId]', action: 'PATCH' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const PATCH = instrumentRoute<RouteContext>('/api/platform/organizations/[orgId]', handlePatch)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { PLATFORM_TAG, invalidateTags, orgScopeTag } from '@/lib/cache'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { orgId: string } }

/**
 * Suspends or reinstates a tenant.
 *
 * Takes the desired state rather than toggling. A blind toggle derives the new
 * value from a row the caller read earlier, so two operators acting on a stale
 * table — or one double-click — can flip a tenant back to the state they were
 * trying to leave. Sending `isActive` explicitly makes the request idempotent.
 *
 * This flag blocks access; it never touches subscription or tenant data, so a
 * suspension can always be lifted without repairing anything.
 */
async function handlePatch(req: NextRequest, { params }: RouteContext) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('organizations:manage')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
  }

  const body = (await req.json().catch(() => ({}))) as { isActive?: unknown }

  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    return errorResponse(req, 'Vlera isActive duhet të jetë true ose false', 400)
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, isActive: true },
    })
    if (!org) {
      return errorResponse(req, 'Organizata nuk u gjet', 404)
    }

    // Older clients sent no body and relied on a toggle; keep them working.
    const nextActive = typeof body.isActive === 'boolean' ? body.isActive : !org.isActive

    if (nextActive === org.isActive) {
      return NextResponse.json({ organization: org, unchanged: true })
    }

    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: { isActive: nextActive },
    })

    // Suspending or reinstating a tenant affects everything cached for it, so
    // this is the one place a whole-org eviction is the correct scope. It also
    // evicts the access-check entry, which is keyed under the same scope.
    invalidateTags(orgScopeTag(orgId), PLATFORM_TAG)

    // Written against the affected tenant so it appears in that organization's
    // own audit trail, which is where an operator investigating it will look.
    await logAuditAction({
      userId: userId ?? 'unknown',
      userEmail: userEmail ?? 'unknown',
      userRole: role ?? 'platform_owner',
      organizationId: orgId,
      action: nextActive ? AUDIT_ACTIONS.ORG_REACTIVATED : AUDIT_ACTIONS.ORG_SUSPENDED,
      entityType: AUDIT_ENTITY_TYPES.ORGANIZATION,
      entityId: orgId,
      description: nextActive
        ? `Organizata "${org.name}" u riaktivizua nga platforma`
        : `Organizata "${org.name}" u pezullua nga platforma`,
      metadata: { previousIsActive: org.isActive, isActive: nextActive },
    })

    return NextResponse.json({ organization: updated })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations/[orgId]', action: 'PATCH' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const PATCH = instrumentRoute<RouteContext>('/api/platform/organizations/[orgId]', handlePatch)

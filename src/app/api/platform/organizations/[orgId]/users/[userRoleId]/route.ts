import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { Role, ROLE_LABELS, LEGACY_ROLE_MAP } from '@/lib/roles'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { PLATFORM_TAG, invalidateTags, orgScopeTag } from '@/lib/cache'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { orgId: string; userRoleId: string } }

const VALID_ROLES: Role[] = ['Administrator', 'Manager', 'Cashier']

/**
 * Changes a tenant member's role from the Platform Owner side.
 *
 * The tenant-facing equivalent (`PUT /api/users/[id]`) scopes the target by the
 * caller's own `organizationId`, which a Platform Owner does not share with the
 * tenant. The scoping here is therefore explicit instead: the record must match
 * both the id in the path *and* the organization in the path, so a valid
 * `userRoleId` from another tenant resolves to nothing rather than to a member
 * of the wrong market.
 *
 * Two roles are refused outright:
 *
 *   - `platform_owner`, which is not a tenant role and must never be granted or
 *     revoked through a per-organization endpoint;
 *   - the last remaining Administrator, because demoting them leaves the tenant
 *     with nobody able to manage their own users, and the recovery path would be
 *     another Platform Owner intervention.
 */
async function handlePatch(req: NextRequest, { params }: RouteContext) {
  const { userId, userEmail, role, organizationId, error } =
    await requirePermission('organizations:manage')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  const userRoleId = parseInt(params.userRoleId, 10)
  if (isNaN(orgId) || isNaN(userRoleId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
  }

  const body = (await req.json().catch(() => ({}))) as { roli?: unknown }
  const roli = typeof body.roli === 'string' ? body.roli : ''

  if (!VALID_ROLES.includes(roli as Role)) {
    return errorResponse(req, 'Rol i pavlefshëm', 400)
  }

  try {
    const target = await prisma.userRole.findFirst({
      where: { id: userRoleId, organizationId: orgId },
      select: { id: true, userId: true, email: true, roli: true },
    })
    if (!target) {
      return errorResponse(req, 'Përdoruesi nuk u gjet në këtë organizatë', 404)
    }

    const currentRole = (LEGACY_ROLE_MAP[target.roli] ?? target.roli) as Role

    if (currentRole === 'platform_owner') {
      return errorResponse(req, 'Roli i pronarit të platformës nuk ndryshohet këtu', 403)
    }

    if (currentRole === roli) {
      return NextResponse.json({ userRole: target, unchanged: true })
    }

    if (currentRole === 'Administrator') {
      const admins = await prisma.userRole.count({
        where: { organizationId: orgId, roli: { in: ['Administrator', 'administrator', 'owner', 'admin'] } },
      })
      if (admins <= 1) {
        return errorResponse(
          req,
          'Kjo organizatë do të mbetej pa asnjë Administrator. Cakto një Administrator tjetër më parë.',
          409,
        )
      }
    }

    const updated = await prisma.userRole.update({
      where: { id: userRoleId },
      data: { roli },
      select: { id: true, userId: true, email: true, roli: true, createdAt: true },
    })

    invalidateTags(orgScopeTag(orgId), PLATFORM_TAG)

    // Recorded against the tenant, so their own Administrator sees that an
    // operator changed a role inside their market.
    await logAuditAction({
      userId: userId ?? 'unknown',
      userEmail: userEmail ?? 'unknown',
      userRole: role ?? 'platform_owner',
      organizationId: orgId,
      action: AUDIT_ACTIONS.CHANGE_ROLE,
      entityType: AUDIT_ENTITY_TYPES.USER,
      entityId: target.userId,
      description: `Roli i "${target.email}" u ndryshua nga "${ROLE_LABELS[currentRole] ?? currentRole}" në "${ROLE_LABELS[roli as Role] ?? roli}" (nga platforma)`,
      metadata: { targetEmail: target.email, oldRole: currentRole, newRole: roli, viaPlatform: true },
    })

    return NextResponse.json({ userRole: updated })
  } catch (err) {
    captureApiError(err, {
      route: '/api/platform/organizations/[orgId]/users/[userRoleId]',
      action: 'PATCH',
    })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const PATCH = instrumentRoute<RouteContext>(
  '/api/platform/organizations/[orgId]/users/[userRoleId]',
  handlePatch,
)

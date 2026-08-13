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

/** Longest suspension note kept; it is operator prose, not a data field. */
const MAX_REASON_LENGTH = 300

/**
 * The Organization Control Center's profile payload.
 *
 * Deliberately shallow: counts come from database aggregates and the only rows
 * returned in full are the subscription, the two most recent access-control
 * audit entries and a short recent-sales strip. Users, staff, activity and audit
 * history each have their own endpoint, loaded by the tab that needs them.
 */
async function handleGet(req: NextRequest, { params }: RouteContext) {
  const { userId, organizationId, error } = await requirePermission('organizations:read')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        telefoni: true,
        adresa: true,
        nipt: true,
        isActive: true,
        createdAt: true,
        subscription: true,
        _count: {
          select: {
            userRoles: true, staff: true, products: true, sales: true,
            suppliers: true, supplies: true, notifications: true, auditLogs: true,
          },
        },
      },
    })
    if (!org) {
      return errorResponse(req, 'Organizata nuk u gjet', 404)
    }

    const [lastSale, salesAgg, salesLast30, owner, accessLog, unreadNotifications] =
      await Promise.all([
        prisma.sale.findFirst({
          where: { organizationId: orgId },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        prisma.sale.aggregate({ where: { organizationId: orgId }, _sum: { totali: true, fitimi: true } }),
        prisma.sale.aggregate({
          where: { organizationId: orgId, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
          _count: { _all: true },
          _sum: { totali: true },
        }),
        prisma.userRole.findFirst({
          where: { organizationId: orgId, roli: 'Administrator' },
          orderBy: { createdAt: 'asc' },
          select: { email: true, createdAt: true },
        }),
        // The suspension trail lives in the tenant's own audit log; this is
        // what lets the Access tab show who suspended, when, and why, without
        // a dedicated column on Organization.
        prisma.auditLog.findMany({
          where: {
            organizationId: orgId,
            action: { in: [AUDIT_ACTIONS.ORG_SUSPENDED, AUDIT_ACTIONS.ORG_REACTIVATED] },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
          select: {
            id: true, action: true, userEmail: true, description: true,
            metadata: true, createdAt: true,
          },
        }),
        prisma.notification.count({ where: { organizationId: orgId, isRead: false } }),
      ])

    const { _count, ...profile } = org

    return NextResponse.json({
      organization: {
        ...profile,
        ownerEmail: owner?.email ?? null,
        lastActivity: lastSale?.createdAt ?? null,
        counts: {
          users: _count.userRoles,
          staff: _count.staff,
          products: _count.products,
          sales: _count.sales,
          suppliers: _count.suppliers,
          supplies: _count.supplies,
          notifications: _count.notifications,
          unreadNotifications,
          auditLogs: _count.auditLogs,
        },
        totals: {
          revenue: salesAgg._sum.totali ?? 0,
          profit: salesAgg._sum.fitimi ?? 0,
          salesLast30Days: salesLast30._count._all,
          revenueLast30Days: salesLast30._sum.totali ?? 0,
        },
      },
      accessLog,
    })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations/[orgId]', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

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

  const body = (await req.json().catch(() => ({}))) as { isActive?: unknown; reason?: unknown }

  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    return errorResponse(req, 'Vlera isActive duhet të jetë true ose false', 400)
  }
  if (body.reason !== undefined && typeof body.reason !== 'string') {
    return errorResponse(req, 'Arsyeja duhet të jetë tekst', 400)
  }

  // Kept in the audit entry rather than on the Organization row: the reason
  // belongs to one suspension event, not to the tenant, and the audit log
  // already stores exactly that shape without a schema change.
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON_LENGTH) : ''

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
        ? `Organizata "${org.name}" u riaktivizua nga platforma${reason ? ` — ${reason}` : ''}`
        : `Organizata "${org.name}" u pezullua nga platforma${reason ? ` — ${reason}` : ''}`,
      metadata: { previousIsActive: org.isActive, isActive: nextActive, reason: reason || null },
    })

    return NextResponse.json({ organization: updated })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations/[orgId]', action: 'PATCH' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute<RouteContext>('/api/platform/organizations/[orgId]', handleGet)
export const PATCH = instrumentRoute<RouteContext>('/api/platform/organizations/[orgId]', handlePatch)

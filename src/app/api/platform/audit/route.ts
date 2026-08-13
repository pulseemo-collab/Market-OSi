import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { endOfBusinessDateExclusive, startOfBusinessDate } from '@/lib/business-time'
import { paginationHeaders, parsePageRequest } from '@/lib/pagination'

export const dynamic = 'force-dynamic'

/** Audit is the fastest-growing table; a page is always bounded. */
const AUDIT_PAGE_SIZE = 50
const AUDIT_SAFETY_LIMIT = 200

/**
 * Cross-tenant audit history.
 *
 * This is the only read in the product that deliberately spans organizations,
 * so it hangs off `global:audit` — a permission granted to `platform_owner`
 * alone. The tenant-facing `/api/audit-logs` is unchanged and still pins
 * `organizationId` to the caller's own tenant; an Administrator reaching this
 * route gets 403 from `requirePermission` before any query runs.
 *
 * Passing `organizationId` narrows the same view to one tenant, which is what
 * the Organization Control Center's Audit tab uses. Narrowing is a filter, not
 * an authorization boundary: the caller already had platform-wide read.
 */
async function handleGet(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('global:audit')
  if (error) return error

  const rl = rateLimit(req, 'audit-logs', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const { searchParams } = new URL(req.url)

    const rawOrg = searchParams.get('organizationId')
    let orgFilter: number | null = null
    if (rawOrg) {
      const parsed = parseInt(rawOrg, 10)
      if (isNaN(parsed)) return errorResponse(req, 'ID e pavlefshme', 400)
      orgFilter = parsed
    }

    const action = searchParams.get('action') || undefined
    const entityType = searchParams.get('entityType') || undefined
    const actor = (searchParams.get('actor') || '').trim()
    const nga = searchParams.get('nga') || undefined
    const deri = searchParams.get('deri') || undefined

    const ngaStart = nga ? startOfBusinessDate(nga) : null
    const deriEnd = deri ? endOfBusinessDateExclusive(deri) : null

    const where = {
      ...(orgFilter !== null ? { organizationId: orgFilter } : {}),
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
      ...(actor ? { userEmail: { contains: actor, mode: 'insensitive' as const } } : {}),
      ...(ngaStart || deriEnd
        ? {
            createdAt: {
              ...(ngaStart ? { gte: ngaStart } : {}),
              ...(deriEnd ? { lt: deriEnd } : {}),
            },
          }
        : {}),
    }

    const page = parsePageRequest(searchParams, {
      defaultPageSize: AUDIT_PAGE_SIZE,
      safetyLimit: AUDIT_SAFETY_LIMIT,
    })

    const [logs, total, actions, entityTypes] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.take,
        skip: page.skip,
        select: {
          id: true,
          organizationId: true,
          userEmail: true,
          userRole: true,
          action: true,
          entityType: true,
          entityId: true,
          description: true,
          createdAt: true,
          organization: { select: { name: true } },
        },
      }),
      prisma.auditLog.count({ where }),
      // Filter vocabularies come from what is actually in the table, so an
      // action added later appears in the dropdown without a code change.
      prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { action: 'asc' } }),
      prisma.auditLog.groupBy({ by: ['entityType'], orderBy: { entityType: 'asc' } }),
    ])

    return NextResponse.json(
      {
        // `metadata` is intentionally not selected. It is free-form JSON written
        // by many call sites, so publishing it wholesale in a cross-tenant view
        // would mean trusting every present and future writer never to put
        // anything sensitive in it.
        logs: logs.map((l) => ({
          id: l.id,
          organizationId: l.organizationId,
          organizationName: l.organization.name,
          userEmail: l.userEmail,
          userRole: l.userRole,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          description: l.description,
          createdAt: l.createdAt,
        })),
        total,
        page: page.page,
        pageSize: page.pageSize,
        totalPages: Math.max(1, Math.ceil(total / page.pageSize)),
        actions: actions.map((a) => ({ action: a.action, count: a._count._all })),
        entityTypes: entityTypes.map((e) => e.entityType),
      },
      { headers: paginationHeaders(page, total) },
    )
  } catch (err) {
    captureApiError(err, { route: '/api/platform/audit', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/platform/audit', handleGet)

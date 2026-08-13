import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { CACHE_TTL, PLATFORM_TAG, cached, invalidateTags } from '@/lib/cache'
import { withIdempotency } from '@/lib/idempotency'
import { ORG_SCAN_LIMIT, countByState, parseOrgListQuery, selectOrgRows } from '@/lib/platform-orgs'

export const dynamic = 'force-dynamic'

/** Platform-owned payloads are keyed under organization 0, not a tenant. */
const PLATFORM_SCOPE = 0

/**
 * One bounded query with database-side aggregate counts — no nested records and
 * no per-organization follow-up query. Search, state filtering, ordering and
 * paging are then applied to this set by `selectOrgRows`.
 */
async function loadOrgRows() {
  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      createdAt: true,
      subscription: {
        select: {
          plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true,
          nextPlan: true, cancelAtPeriodEnd: true, cancelledAt: true,
        },
      },
      _count: { select: { userRoles: true, staff: true, products: true, sales: true } },
      sales: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: ORG_SCAN_LIMIT,
  })

  return organizations.map((org) => ({
    id: org.id,
    name: org.name,
    isActive: org.isActive,
    usersCount: org._count.userRoles,
    staffCount: org._count.staff,
    productsCount: org._count.products,
    salesCount: org._count.sales,
    lastActivity: org.sales[0]?.createdAt ?? null,
    createdAt: org.createdAt,
    subscription: org.subscription,
  }))
}

async function handleGet(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('organizations:read')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const rows = await cached(
      {
        namespace: 'platform-orgs',
        organizationId: PLATFORM_SCOPE,
        ttlMs: CACHE_TTL.platform,
        tags: [PLATFORM_TAG],
      },
      loadOrgRows,
    )

    const query = parseOrgListQuery(new URL(req.url).searchParams)
    const { total, rows: page } = selectOrgRows(rows, query)

    return NextResponse.json({
      organizations: page,
      total,
      scanned: rows.length,
      // Tells the client the scan ceiling was reached, so the UI can say the
      // list is truncated rather than quietly showing a partial portfolio.
      truncated: rows.length >= ORG_SCAN_LIMIT,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      // Counts cover the whole portfolio, not the filtered page, so the filter
      // chips keep showing what is available behind each filter.
      stateCounts: countByState(rows),
    })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handlePost(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('organizations:manage')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  // A double submit here would create a second organization with its own trial.
  return withIdempotency(
    req,
    { route: 'POST /api/platform/organizations', organizationId: organizationId ?? 0, userId: userId! },
    () => createOrganization(req),
  )
}

async function createOrganization(req: NextRequest) {
  try {
    const body = await req.json()
    const name = (body.name ?? '').trim()
    if (!name) {
      return errorResponse(req, 'Emri është i detyrueshëm', 400)
    }

    const org = await prisma.organization.create({
      data: {
        name,
        subscription: {
          create: {
            plan: 'trial',
            status: 'trialing',
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        },
      },
    })

    invalidateTags(PLATFORM_TAG)

    return NextResponse.json({ organization: org }, { status: 201 })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations', action: 'POST' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/platform/organizations', handleGet)
export const POST = instrumentRoute('/api/platform/organizations', handlePost)

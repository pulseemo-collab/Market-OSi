import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { invalidateTags, orgTag } from '@/lib/cache'
import { withIdempotency } from '@/lib/idempotency'
import { paginationHeaders, parsePageRequest } from '@/lib/pagination'
import { classifyError, errorResponseFrom } from '@/lib/errors'
import { recordTransactionFailure } from '@/lib/metrics'

/** A supply can carry many lines; it gets more room than a POS sale. */
const SUPPLY_TX_TIMEOUT_MS = parseInt(process.env.SUPPLY_TX_TIMEOUT_MS ?? '20000')
const SUPPLY_TX_MAX_WAIT_MS = parseInt(process.env.SUPPLY_TX_MAX_WAIT_MS ?? '5000')

async function handleGet(req: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('supplies:read')
  if (error) return error

  const rl = rateLimit(req, 'supplies', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  try {
    const { searchParams } = new URL(req.url)
    const where = { organizationId: organizationId! }
    const page = parsePageRequest(searchParams)

    const query = {
      where,
      include: {
        furnitor: { select: { id: true, emri: true } },
        items: {
          include: {
            product: { select: { id: true, emri: true, njesia: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: page.take,
    }

    if (!page.explicit) {
      return NextResponse.json(await prisma.supply.findMany(query))
    }

    const [supplies, total] = await Promise.all([
      prisma.supply.findMany({ ...query, skip: page.skip }),
      prisma.supply.count({ where }),
    ])

    return NextResponse.json(supplies, { headers: paginationHeaders(page, total) })
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/supplies', action: 'GET' })
    console.error('Supplies GET error:', error)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handlePost(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('supplies:write')
  if (error) return error

  const rl = rateLimit(req, 'supplies', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  return withIdempotency(
    req,
    { route: 'POST /api/supplies', organizationId: organizationId!, userId: userId! },
    () => createSupply(req, userId!, userEmail!, role!, organizationId!),
  )
}

async function createSupply(
  req: NextRequest,
  userId: string,
  userEmail: string,
  role: string,
  organizationId: number,
) {
  try {
    const body = await req.json()
    const { furnitorId, data, shenime, items } = body

    if (!items || items.length === 0) {
      return errorResponse(req, 'Nuk ka produkte në furnizim', 400)
    }

    for (const item of items) {
      if (!item.productId) {
        return errorResponse(req, 'Produkti është i pavlefshëm', 400)
      }
      if (typeof item.sasia !== 'number' || item.sasia <= 0) {
        return errorResponse(req, `Sasia duhet të jetë pozitive për: ${item.emriProduktit}`, 400)
      }
      if (typeof item.cmimiBlerjes !== 'number' || item.cmimiBlerjes < 0) {
        return errorResponse(req, `Çmimi i blerjes i pavlefshëm për: ${item.emriProduktit}`, 400)
      }
    }

    const totali = items.reduce(
      (sum: number, item: { sasia: number; cmimiBlerjes: number }) =>
        sum + item.sasia * item.cmimiBlerjes,
      0
    )

    const supply = await prisma.$transaction(async (tx) => {
      const newSupply = await tx.supply.create({
        data: {
          furnitorId: furnitorId ? Number(furnitorId) : null,
          data: data ? new Date(data) : new Date(),
          shenime: shenime || null,
          totali,
          organizationId,
          items: {
            create: items.map((item: {
              productId: number
              emriProduktit: string
              sasia: number
              njesia: string
              cmimiBlerjes: number
            }) => ({
              productId: item.productId,
              emriProduktit: item.emriProduktit,
              sasia: item.sasia,
              njesia: item.njesia,
              cmimiBlerjes: item.cmimiBlerjes,
              totali: item.sasia * item.cmimiBlerjes,
            })),
          },
        },
        include: {
          furnitor: { select: { id: true, emri: true } },
          items: {
            include: { product: { select: { id: true, emri: true, njesia: true } } },
          },
        },
      })

      // Ascending product id, matching the sale paths. A supply only ever
      // increments stock so it cannot oversell, but it locks the same rows a
      // concurrent sale is decrementing — without a shared order the two can
      // deadlock.
      const orderedItems = [...items].sort(
        (a: { productId: number }, b: { productId: number }) => a.productId - b.productId,
      )

      for (const item of orderedItems) {
        await tx.product.updateMany({
          where: { id: item.productId, organizationId },
          data: {
            sasia: { increment: item.sasia },
            ...(item.updatePrice ? { cmimiBlerjes: item.cmimiBlerjes } : {}),
          },
        })
      }

      return newSupply
    }, { timeout: SUPPLY_TX_TIMEOUT_MS, maxWait: SUPPLY_TX_MAX_WAIT_MS })

    // A supply raises stock and may change purchase prices, so product-derived
    // payloads (dashboard, reorder suggestions) are stale too.
    invalidateTags(orgTag(organizationId, 'supplies'), orgTag(organizationId, 'products'))

    await logAuditAction({
      userId,
      userEmail,
      userRole: role,
      organizationId,
      action: AUDIT_ACTIONS.CREATE,
      entityType: AUDIT_ENTITY_TYPES.SUPPLY,
      entityId: supply.id,
      description: `Furnizim i ri u krijua — ${supply.items.length} produkte, totali ${supply.totali.toFixed(2)} L`,
      metadata: { totali: supply.totali, numriProdukteve: supply.items.length, furnitorId },
    })

    return NextResponse.json(supply, { status: 201 })
  } catch (error) {
    const classified = classifyError(error)

    if (classified.status >= 500) {
      recordTransactionFailure('create-supply')
      captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/supplies', action: 'POST' })
    }

    console.error('Supplies POST error:', classified.detail ?? classified.message)
    return errorResponseFrom(req, classified)
  }
}

export const GET = instrumentRoute('/api/supplies', handleGet)
export const POST = instrumentRoute('/api/supplies', handlePost)

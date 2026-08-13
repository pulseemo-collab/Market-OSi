import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { createNotification, NOTIFICATION_TYPES, NOTIFICATION_SEVERITIES } from '@/lib/notifications'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { resolveStaffAuth } from '@/lib/staff-auth'
import type { Role } from '@/lib/roles'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { invalidateTags, orgTag } from '@/lib/cache'
import { withIdempotency } from '@/lib/idempotency'
import { paginationHeaders, parsePageRequest } from '@/lib/pagination'
import { queueLowStockScan } from '@/lib/stock-alerts'
import { StockConflictError, classifyError, errorResponseFrom } from '@/lib/errors'
import { recordStockConflict, recordTransactionFailure } from '@/lib/metrics'
import { applyStockDeltas, netDeltas, sumByProduct } from '@/lib/stock'

const LARGE_SALE_THRESHOLD = parseInt(process.env.LARGE_SALE_THRESHOLD || '5000')

/**
 * Interactive-transaction bounds for a sale.
 *
 * `timeout` caps how long the transaction may hold its row locks — a stuck sale
 * must not block every other cashier selling the same product. `maxWait` caps
 * how long it waits for a pooled connection before failing, so a saturated pool
 * surfaces as a fast error rather than a hung terminal.
 */
const SALE_TX_TIMEOUT_MS = parseInt(process.env.SALE_TX_TIMEOUT_MS ?? '10000')
const SALE_TX_MAX_WAIT_MS = parseInt(process.env.SALE_TX_MAX_WAIT_MS ?? '5000')

async function handleGet(req: NextRequest) {
  // Dual auth: Supabase session or staff cashier session
  const supabase = await requirePermission('sales:read')
  let userId: string | null
  let role: Role | null
  let organizationId: number | null

  if (!supabase.error) {
    userId = supabase.userId
    role = supabase.role
    organizationId = supabase.organizationId
  } else {
    const staff = await resolveStaffAuth(req, ['Cashier'])
    if (staff.error) return staff.error
    userId = staff.userId
    role = staff.staffRole as Role
    organizationId = staff.organizationId
  }

  const rl = rateLimit(req, 'sales', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  try {
    const { searchParams } = new URL(req.url)
    const periudha = searchParams.get('periudha') || 'sot'
    const dataParam = searchParams.get('data') // YYYY-MM-DD for exact date filter

    // All three selections (exact date, "dje", rolling period) differ only in
    // the createdAt range, so the range is resolved first and the query is
    // issued once.
    let createdAt: { gte: Date; lt?: Date }

    if (dataParam) {
      const d = new Date(dataParam)
      createdAt = {
        gte: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
        lt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0),
      }
    } else {
      const now = new Date()
      const dateFrom = new Date(now)

      switch (periudha) {
        case 'dje': {
          dateFrom.setDate(dateFrom.getDate() - 1)
          dateFrom.setHours(0, 0, 0, 0)
          const djeTomorrow = new Date(dateFrom)
          djeTomorrow.setDate(djeTomorrow.getDate() + 1)
          createdAt = { gte: dateFrom, lt: djeTomorrow }
          break
        }
        case 'jave':
          dateFrom.setDate(dateFrom.getDate() - 7)
          dateFrom.setHours(0, 0, 0, 0)
          createdAt = { gte: dateFrom }
          break
        case 'muaj':
          dateFrom.setDate(1)
          dateFrom.setHours(0, 0, 0, 0)
          createdAt = { gte: dateFrom }
          break
        default:
          dateFrom.setHours(0, 0, 0, 0)
          createdAt = { gte: dateFrom }
      }
    }

    const where = { organizationId: organizationId!, createdAt }
    const page = parsePageRequest(searchParams)

    // createdAt alone is not unique, so id breaks ties and keeps pages stable.
    const query = {
      where,
      include: { items: { include: { product: true } } },
      orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
      take: page.take,
    }

    if (!page.explicit) {
      return NextResponse.json(await prisma.sale.findMany(query))
    }

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({ ...query, skip: page.skip }),
      prisma.sale.count({ where }),
    ])

    return NextResponse.json(sales, { headers: paginationHeaders(page, total) })
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/sales', action: 'GET' })
    console.error('Sales GET error:', error)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handlePost(req: NextRequest) {
  // Dual auth: Supabase session or staff cashier session
  const supabase = await requirePermission('sales:create')
  let userId: string | null
  let userEmail: string | null
  let role: Role | null
  let organizationId: number | null
  let saleStaffId: number | undefined
  let saleStaffName: string | undefined

  if (!supabase.error) {
    userId = supabase.userId
    userEmail = supabase.userEmail
    role = supabase.role
    organizationId = supabase.organizationId
  } else {
    const staff = await resolveStaffAuth(req, ['Cashier'])
    if (staff.error) return staff.error
    userId = staff.userId
    userEmail = staff.staffName
    role = staff.staffRole as Role
    organizationId = staff.organizationId
    saleStaffId = staff.staffId
    saleStaffName = staff.staffName
  }

  const rl = rateLimit(req, 'sales', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  return withIdempotency(
    req,
    { route: 'POST /api/sales', organizationId: organizationId!, userId: userId! },
    () =>
      createSale(req, {
        userId: userId!,
        userEmail: userEmail!,
        role: role!,
        organizationId: organizationId!,
        saleStaffId,
        saleStaffName,
      }),
  )
}

interface SaleActor {
  userId: string
  userEmail: string
  role: Role
  organizationId: number
  saleStaffId: number | undefined
  saleStaffName: string | undefined
}

interface SaleItemInput {
  productId: number
  emriProduktit: string
  sasia: number
}

async function createSale(req: NextRequest, actor: SaleActor) {
  const { userId, userEmail, role, organizationId, saleStaffId, saleStaffName } = actor

  try {
    const body = await req.json()
    const { items, shenime, paymentMethod } = body as {
      items: SaleItemInput[]
      shenime?: string
      paymentMethod?: string
    }
    const validPaymentMethod = ['cash', 'bank'].includes(paymentMethod ?? '') ? paymentMethod! : 'cash'

    if (!items || items.length === 0) {
      return errorResponse(req, 'Nuk ka produkte në shitje', 400)
    }

    for (const item of items) {
      if (!Number.isFinite(item.sasia) || item.sasia <= 0) {
        return errorResponse(req, `Sasia duhet të jetë pozitive për: ${item.emriProduktit}`, 400)
      }
    }

    // A basket can list the same product on more than one line. Validating each
    // line against full stock would let two lines of one unit each pass against
    // a stock of one, so demand is summed per product and checked once.
    const requestedByProduct = sumByProduct(items)

    // One lookup for the whole basket. This previously ran a query per line
    // item for validation and another per line item inside the transaction —
    // three round trips per product on a POS request.
    const products = await prisma.product.findMany({
      where: { id: { in: Array.from(requestedByProduct.keys()) }, organizationId },
    })
    const productById = new Map(products.map((p) => [p.id, p]))

    let totali = 0
    let fitimi = 0

    for (const item of items) {
      const product = productById.get(item.productId)

      if (!product) {
        return errorResponse(req, `Produkti nuk u gjet: ${item.emriProduktit}`, 404)
      }

      totali += product.cmimiShitjes * item.sasia
      fitimi += (product.cmimiShitjes - product.cmimiBlerjes) * item.sasia
    }

    // Reject what is already impossible before opening a transaction, so the
    // common "not enough stock" case stays a cheap 400 and never holds a row
    // lock. The authoritative check is the guarded decrement below.
    for (const [productId, requested] of Array.from(requestedByProduct)) {
      const product = productById.get(productId)!
      if (product.sasia < requested) {
        return errorResponse(
          req,
          `Stoku i pamjaftueshëm për: ${product.emri}. Stoku: ${product.sasia}`,
          400,
        )
      }
    }

    // A sale only consumes stock, so every delta is negative.
    const stockDeltas = netDeltas(new Map(), requestedByProduct)

    const sale = await prisma.$transaction(
      async (tx) => {
        const newSale = await tx.sale.create({
          data: {
            totali,
            fitimi,
            shenime: shenime || null,
            paymentMethod: validPaymentMethod,
            organizationId,
            staffId: saleStaffId ?? null,
            staffName: saleStaffName ?? null,
            items: {
              create: items.map((item) => {
                const product = productById.get(item.productId)!
                return {
                  productId: item.productId,
                  emriProduktit: item.emriProduktit,
                  sasia: item.sasia,
                  cmimiBlerjes: product.cmimiBlerjes,
                  cmimiShitjes: product.cmimiShitjes,
                  fitimi: (product.cmimiShitjes - product.cmimiBlerjes) * item.sasia,
                }
              }),
            },
          },
          include: { items: { include: { product: true } } },
        })

        // The stock check that actually decides the sale — a guarded, ordered
        // decrement that throws and rolls the sale back if another transaction
        // took the units first. See src/lib/stock.ts.
        await applyStockDeltas(tx, stockDeltas, {
          organizationId,
          nameOf: (id) => productById.get(id)?.emri,
        })

        return newSale
      },
      { timeout: SALE_TX_TIMEOUT_MS, maxWait: SALE_TX_MAX_WAIT_MS },
    )

    // Sales change revenue totals; the stock decrement changes product figures.
    invalidateTags(orgTag(organizationId, 'sales'), orgTag(organizationId, 'products'))

    const methodLabel = validPaymentMethod === 'cash' ? 'Cash' : 'Bankë'
    const staffLabel = saleStaffName ? ` nga ${saleStaffName}` : ''
    await logAuditAction({
      userId,
      userEmail,
      userRole: role,
      organizationId,
      action: AUDIT_ACTIONS.CREATE,
      entityType: AUDIT_ENTITY_TYPES.SALE,
      entityId: sale.id,
      description: `Shitje e re #${sale.id} — ${sale.totali.toFixed(2)} L (${methodLabel}, ${sale.items.length} produkte${staffLabel})`,
      metadata: { totali: sale.totali, fitimi: sale.fitimi, paymentMethod: validPaymentMethod, staffId: saleStaffId, staffName: saleStaffName },
    })

    // Trigger LARGE_SALE notification (assigned to the seller)
    if (sale.totali >= LARGE_SALE_THRESHOLD) {
      await createNotification({
        organizationId,
        userId,
        type: NOTIFICATION_TYPES.LARGE_SALE,
        title: 'Shitje e Madhe',
        message: `Shitja #${sale.id} arriti ${sale.totali.toFixed(0)} L (${sale.items.length} produkte, ${methodLabel})`,
        severity: NOTIFICATION_SEVERITIES.MEDIUM,
        metadata: { saleId: sale.id, totali: sale.totali, fitimi: sale.fitimi, paymentMethod: validPaymentMethod },
      })
    }

    // The low-stock check re-reads the sold products, looks for recent unread
    // alerts and inserts one notification per affected product. None of that
    // changes the response, so the cashier does not wait for it.
    queueLowStockScan(organizationId, items.map((i) => i.productId))

    return NextResponse.json(sale, { status: 201 })
  } catch (error) {
    const classified = classifyError(error)

    // A lost stock race is an expected outcome under concurrency, not a fault.
    // It rolled the sale back cleanly, so it is reported as a 409 the terminal
    // can act on and is never sent to Sentry as an exception.
    if (classified instanceof StockConflictError) {
      recordStockConflict()
      recordTransactionFailure('create-sale')
      return errorResponseFrom(req, classified)
    }

    if (classified.status >= 500) {
      recordTransactionFailure('create-sale')
      captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/sales', action: 'POST' })
    }

    console.error('Sales POST error:', classified.detail ?? classified.message)
    return errorResponseFrom(req, classified)
  }
}

export const GET = instrumentRoute('/api/sales', handleGet)
export const POST = instrumentRoute('/api/sales', handlePost)

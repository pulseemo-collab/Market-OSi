import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, buildFieldChanges, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { invalidateTags, orgTag } from '@/lib/cache'
import { StockConflictError, classifyError, errorResponseFrom } from '@/lib/errors'
import { recordStockConflict, recordTransactionFailure } from '@/lib/metrics'
import { applyStockDeltas, netDeltas, sumByProduct } from '@/lib/stock'

type RouteContext = { params: { id: string } }

/** Matches the create path — see the note in /api/sales/route.ts. */
const SALE_TX_TIMEOUT_MS = parseInt(process.env.SALE_TX_TIMEOUT_MS ?? '10000')
const SALE_TX_MAX_WAIT_MS = parseInt(process.env.SALE_TX_MAX_WAIT_MS ?? '5000')

async function handlePut(req: NextRequest, { params }: RouteContext) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('sales:manage')
  if (error) return error

  const rl = rateLimit(req, 'sales', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  try {
    const saleId = parseInt(params.id)
    if (isNaN(saleId)) {
      return errorResponse(req, 'ID i pavlefshëm', 400)
    }

    const body = await req.json()
    const { items } = body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return errorResponse(req, 'Nuk ka produkte në shitje', 400)
    }

    const existingSale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId: organizationId! },
      include: { items: true },
    })

    if (!existingSale) {
      return errorResponse(req, 'Fatura nuk u gjet', 404)
    }

    const originalQtyMap = new Map<number, number>()
    for (const item of existingSale.items) {
      originalQtyMap.set(item.productId, (originalQtyMap.get(item.productId) || 0) + item.sasia)
    }

    let totali = 0
    let fitimi = 0

    const validatedItems: Array<{
      productId: number
      emriProduktit: string
      sasia: number
      cmimiBlerjes: number
      cmimiShitjes: number
      fitimiItem: number
    }> = []

    // One lookup for every line item, instead of a query per item inside the
    // validation loop.
    const referencedIds = items
      .map((item: { productId: unknown }) => Number(item.productId))
      .filter((id: number) => !isNaN(id))
    const products = await prisma.product.findMany({
      where: { id: { in: referencedIds }, organizationId: organizationId! },
    })
    const productById = new Map(products.map((p) => [p.id, p]))

    for (const item of items) {
      const productId = Number(item.productId)
      const sasia = Number(item.sasia)

      if (isNaN(productId) || isNaN(sasia) || sasia <= 0) {
        return errorResponse(req, 'Të dhëna të pavlefshme', 400)
      }

      const product = productById.get(productId)
      if (!product) {
        return errorResponse(req, 'Produkti nuk u gjet', 404)
      }

      const originalQty = originalQtyMap.get(productId) || 0
      const availableStock = product.sasia + originalQty

      if (sasia > availableStock) {
        return errorResponse(req, `Stoku i pamjaftueshëm për: ${product.emri}. Disponibël: ${availableStock}`, 400)
      }

      const fitimiItem = (product.cmimiShitjes - product.cmimiBlerjes) * sasia
      totali += product.cmimiShitjes * sasia
      fitimi += fitimiItem

      validatedItems.push({
        productId,
        emriProduktit: product.emri,
        sasia,
        cmimiBlerjes: product.cmimiBlerjes,
        cmimiShitjes: product.cmimiShitjes,
        fitimiItem,
      })
    }

    // Net the two directions per product before touching the database. Summing
    // first means each product row is written exactly once, which halves the
    // locks held and removes the window between "restored" and "re-taken" in
    // which another sale could observe inflated stock.
    const deltaByProduct = netDeltas(originalQtyMap, sumByProduct(validatedItems))

    await prisma.$transaction(
      async (tx) => {
        await tx.saleItem.deleteMany({ where: { saleId } })

        await tx.sale.update({
          where: { id: saleId },
          data: {
            totali,
            fitimi,
            items: {
              create: validatedItems.map((item) => ({
                productId: item.productId,
                emriProduktit: item.emriProduktit,
                sasia: item.sasia,
                cmimiBlerjes: item.cmimiBlerjes,
                cmimiShitjes: item.cmimiShitjes,
                fitimi: item.fitimiItem,
              })),
            },
          },
        })

        await applyStockDeltas(tx, deltaByProduct, {
          organizationId: organizationId!,
          nameOf: (id) => productById.get(id)?.emri,
        })
      },
      { timeout: SALE_TX_TIMEOUT_MS, maxWait: SALE_TX_MAX_WAIT_MS },
    )

    invalidateTags(orgTag(organizationId!, 'sales'), orgTag(organizationId!, 'products'))

    const updatedSale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { product: true } } },
    })

    const saleChanges = buildFieldChanges([
      { label: 'Totali', old: existingSale.totali.toFixed(2) + ' L', new: totali.toFixed(2) + ' L' },
      { label: 'Fitimi', old: existingSale.fitimi.toFixed(2) + ' L', new: fitimi.toFixed(2) + ' L' },
      { label: 'Numri i artikujve', old: existingSale.items.length, new: validatedItems.length },
    ])

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.UPDATE,
      entityType: AUDIT_ENTITY_TYPES.SALE,
      entityId: saleId,
      description: `Shitja #${saleId} u modifikua`,
      metadata: { changes: saleChanges },
    })

    return NextResponse.json(updatedSale)
  } catch (error) {
    const classified = classifyError(error)

    if (classified instanceof StockConflictError) {
      recordStockConflict()
      recordTransactionFailure('update-sale')
      return errorResponseFrom(req, classified)
    }

    if (classified.status >= 500) {
      recordTransactionFailure('update-sale')
      captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/sales/[id]', action: 'PUT' })
    }

    console.error('Sale PUT error:', classified.detail ?? classified.message)
    return errorResponseFrom(req, classified)
  }
}

async function handleDelete(req: NextRequest, { params }: RouteContext) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('sales:manage')
  if (error) return error

  const rl = rateLimit(req, 'sales', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  try {
    const saleId = parseInt(params.id)

    if (isNaN(saleId)) {
      return errorResponse(req, 'ID i pavlefshëm', 400)
    }

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId: organizationId! },
      include: { items: true },
    })

    if (!sale) {
      return errorResponse(req, 'Fatura nuk u gjet', 404)
    }

    // Deleting a sale returns everything it held — all deltas positive, so the
    // guard never trips, but the shared ordering still applies so a deletion
    // cannot deadlock against a concurrent sale touching the same products.
    const returnedByProduct = sumByProduct(sale.items)

    await prisma.$transaction(
      async (tx) => {
        await applyStockDeltas(tx, returnedByProduct, { organizationId: organizationId! })

        await tx.sale.delete({ where: { id: saleId } })
      },
      { timeout: SALE_TX_TIMEOUT_MS, maxWait: SALE_TX_MAX_WAIT_MS },
    )

    invalidateTags(orgTag(organizationId!, 'sales'), orgTag(organizationId!, 'products'))

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.DELETE,
      entityType: AUDIT_ENTITY_TYPES.SALE,
      entityId: saleId,
      description: `Shitja #${saleId} u fshi (${sale.totali.toFixed(2)} L)`,
      metadata: { totali: sale.totali, fitimi: sale.fitimi },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const classified = classifyError(error)

    if (classified.status >= 500) {
      recordTransactionFailure('delete-sale')
      captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/sales/[id]', action: 'DELETE' })
    }

    console.error('Sale DELETE error:', classified.detail ?? classified.message)
    return errorResponseFrom(req, classified)
  }
}

export const PUT = instrumentRoute<RouteContext>('/api/sales/[id]', handlePut)
export const DELETE = instrumentRoute<RouteContext>('/api/sales/[id]', handleDelete)

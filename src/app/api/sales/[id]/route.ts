import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, buildFieldChanges, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { invalidateTags, orgTag } from '@/lib/cache'

type RouteContext = { params: { id: string } }

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

    await prisma.$transaction(async (tx) => {
      for (const origItem of existingSale.items) {
        await tx.product.updateMany({
          where: { id: origItem.productId, organizationId: organizationId! },
          data: { sasia: { increment: origItem.sasia } },
        })
      }

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

      for (const item of validatedItems) {
        await tx.product.updateMany({
          where: { id: item.productId, organizationId: organizationId! },
          data: { sasia: { decrement: item.sasia } },
        })
      }
    })

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
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/sales/[id]', action: 'PUT' })
    console.error('Sale PUT error:', error)
    return errorResponse(req, 'Gabim në server', 500)
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

    await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        await tx.product.updateMany({
          where: { id: item.productId, organizationId: organizationId! },
          data: { sasia: { increment: item.sasia } },
        })
      }

      await tx.sale.delete({ where: { id: saleId } })
    })

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
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/sales/[id]', action: 'DELETE' })
    console.error('Sale DELETE error:', error)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const PUT = instrumentRoute<RouteContext>('/api/sales/[id]', handlePut)
export const DELETE = instrumentRoute<RouteContext>('/api/sales/[id]', handleDelete)

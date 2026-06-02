import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, buildFieldChanges, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('sales:manage')
  if (error) return error

  const rl = rateLimit(req, 'sales', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const saleId = parseInt(params.id)
    if (isNaN(saleId)) {
      return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
    }

    const body = await req.json()
    const { items } = body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Nuk ka produkte në shitje' }, { status: 400 })
    }

    const existingSale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId: organizationId! },
      include: { items: true },
    })

    if (!existingSale) {
      return NextResponse.json({ error: 'Fatura nuk u gjet' }, { status: 404 })
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

    for (const item of items) {
      const productId = Number(item.productId)
      const sasia = Number(item.sasia)

      if (isNaN(productId) || isNaN(sasia) || sasia <= 0) {
        return NextResponse.json({ error: 'Të dhëna të pavlefshme' }, { status: 400 })
      }

      const product = await prisma.product.findFirst({
        where: { id: productId, organizationId: organizationId! },
      })
      if (!product) {
        return NextResponse.json({ error: 'Produkti nuk u gjet' }, { status: 404 })
      }

      const originalQty = originalQtyMap.get(productId) || 0
      const availableStock = product.sasia + originalQty

      if (sasia > availableStock) {
        return NextResponse.json(
          { error: `Stoku i pamjaftueshëm për: ${product.emri}. Disponibël: ${availableStock}` },
          { status: 400 }
        )
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
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('sales:manage')
  if (error) return error

  const rl = rateLimit(req, 'sales', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const saleId = parseInt(params.id)

    if (isNaN(saleId)) {
      return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
    }

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId: organizationId! },
      include: { items: true },
    })

    if (!sale) {
      return NextResponse.json({ error: 'Fatura nuk u gjet' }, { status: 404 })
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
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

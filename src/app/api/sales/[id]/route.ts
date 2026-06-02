import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requirePermission('sales:manage')
  if (error) return error

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

    const existingSale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    })

    if (!existingSale) {
      return NextResponse.json({ error: 'Fatura nuk u gjet' }, { status: 404 })
    }

    // Map original quantities per productId (for stock restoration check)
    const originalQtyMap = new Map<number, number>()
    for (const item of existingSale.items) {
      originalQtyMap.set(item.productId, (originalQtyMap.get(item.productId) || 0) + item.sasia)
    }

    // Validate items and calculate new totals
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

      const product = await prisma.product.findUnique({ where: { id: productId } })
      if (!product) {
        return NextResponse.json({ error: 'Produkti nuk u gjet' }, { status: 404 })
      }

      // Available stock = current stock + original quantity from this sale (will be restored)
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
      // 1. Restore original stock
      for (const origItem of existingSale.items) {
        await tx.product.update({
          where: { id: origItem.productId },
          data: { sasia: { increment: origItem.sasia } },
        })
      }

      // 2. Delete old sale items
      await tx.saleItem.deleteMany({ where: { saleId } })

      // 3. Update sale totals and create new items
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

      // 4. Decrement stock for new quantities
      for (const item of validatedItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: { sasia: { decrement: item.sasia } },
        })
      }
    })

    const updatedSale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { product: true } } },
    })

    return NextResponse.json(updatedSale)
  } catch (error) {
    console.error('Sale PUT error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requirePermission('sales:manage')
  if (error) return error

  try {
    const saleId = parseInt(params.id)

    if (isNaN(saleId)) {
      return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
    }

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    })

    if (!sale) {
      return NextResponse.json({ error: 'Fatura nuk u gjet' }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { sasia: { increment: item.sasia } },
        })
      }

      await tx.sale.delete({ where: { id: saleId } })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Sale DELETE error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

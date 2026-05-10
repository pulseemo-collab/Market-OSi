import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const periudha = searchParams.get('periudha') || 'sot'

    const now = new Date()
    let dateFrom: Date

    switch (periudha) {
      case 'sot':
        dateFrom = new Date(now)
        dateFrom.setHours(0, 0, 0, 0)
        break
      case 'dje':
        dateFrom = new Date(now)
        dateFrom.setDate(dateFrom.getDate() - 1)
        dateFrom.setHours(0, 0, 0, 0)
        const djeTomorrow = new Date(dateFrom)
        djeTomorrow.setDate(djeTomorrow.getDate() + 1)
        const salesDje = await prisma.sale.findMany({
          where: {
            createdAt: { gte: dateFrom, lt: djeTomorrow },
          },
          include: { items: { include: { product: true } } },
          orderBy: { createdAt: 'desc' },
        })
        return NextResponse.json(salesDje)
      case 'jave':
        dateFrom = new Date(now)
        dateFrom.setDate(dateFrom.getDate() - 7)
        dateFrom.setHours(0, 0, 0, 0)
        break
      case 'muaj':
        dateFrom = new Date(now)
        dateFrom.setDate(1)
        dateFrom.setHours(0, 0, 0, 0)
        break
      default:
        dateFrom = new Date(now)
        dateFrom.setHours(0, 0, 0, 0)
    }

    const sales = await prisma.sale.findMany({
      where: {
        createdAt: { gte: dateFrom },
      },
      include: {
        items: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(sales)
  } catch (error) {
    console.error('Sales GET error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { items, shenime } = body

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'Nuk ka produkte në shitje' },
        { status: 400 }
      )
    }

    // Validate stock and calculate totals
    let totali = 0
    let fitimi = 0

    for (const item of items) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId },
      })

      if (!product) {
        return NextResponse.json(
          { error: `Produkti nuk u gjet: ${item.emriProduktit}` },
          { status: 404 }
        )
      }

      if (product.sasia < item.sasia) {
        return NextResponse.json(
          { error: `Stoku i pamjaftueshëm për: ${product.emri}. Stoku: ${product.sasia}` },
          { status: 400 }
        )
      }

      totali += product.cmimiShitjes * item.sasia
      fitimi += (product.cmimiShitjes - product.cmimiBlerjes) * item.sasia
    }

    // Create sale and reduce stock in a transaction
    const sale = await prisma.$transaction(async (tx) => {
      const newSale = await tx.sale.create({
        data: {
          totali,
          fitimi,
          shenime: shenime || null,
          items: {
            create: await Promise.all(
              items.map(async (item: {
                productId: number
                emriProduktit: string
                sasia: number
                cmimiBlerjes: number
                cmimiShitjes: number
              }) => {
                const product = await tx.product.findUnique({
                  where: { id: item.productId },
                })
                return {
                  productId: item.productId,
                  emriProduktit: item.emriProduktit,
                  sasia: item.sasia,
                  cmimiBlerjes: product!.cmimiBlerjes,
                  cmimiShitjes: product!.cmimiShitjes,
                  fitimi: (product!.cmimiShitjes - product!.cmimiBlerjes) * item.sasia,
                }
              })
            ),
          },
        },
        include: { items: { include: { product: true } } },
      })

      // Reduce stock for each item
      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { sasia: { decrement: item.sasia } },
        })
      }

      return newSale
    })

    return NextResponse.json(sale, { status: 201 })
  } catch (error) {
    console.error('Sales POST error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

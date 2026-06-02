import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'

export async function GET(req: NextRequest) {
  const { organizationId, error } = await requirePermission('sales:read')
  if (error) return error

  try {
    const { searchParams } = new URL(req.url)
    const periudha = searchParams.get('periudha') || 'sot'
    const dataParam = searchParams.get('data') // YYYY-MM-DD for exact date filter

    // Exact date filter
    if (dataParam) {
      const d = new Date(dataParam)
      const dateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
      const dateEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0)
      const salesByDate = await prisma.sale.findMany({
        where: { organizationId: organizationId!, createdAt: { gte: dateStart, lt: dateEnd } },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return NextResponse.json(salesByDate)
    }

    const now = new Date()
    let dateFrom: Date

    switch (periudha) {
      case 'sot':
        dateFrom = new Date(now)
        dateFrom.setHours(0, 0, 0, 0)
        break
      case 'dje': {
        dateFrom = new Date(now)
        dateFrom.setDate(dateFrom.getDate() - 1)
        dateFrom.setHours(0, 0, 0, 0)
        const djeTomorrow = new Date(dateFrom)
        djeTomorrow.setDate(djeTomorrow.getDate() + 1)
        const salesDje = await prisma.sale.findMany({
          where: {
            organizationId: organizationId!,
            createdAt: { gte: dateFrom, lt: djeTomorrow },
          },
          include: { items: { include: { product: true } } },
          orderBy: { createdAt: 'desc' },
        })
        return NextResponse.json(salesDje)
      }
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
        organizationId: organizationId!,
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
  const { organizationId, error } = await requirePermission('sales:create')
  if (error) return error

  try {
    const body = await req.json()
    const { items, shenime, paymentMethod } = body
    const validPaymentMethod = ['cash', 'bank'].includes(paymentMethod) ? paymentMethod : 'cash'

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'Nuk ka produkte në shitje' },
        { status: 400 }
      )
    }

    let totali = 0
    let fitimi = 0

    for (const item of items) {
      const product = await prisma.product.findFirst({
        where: { id: item.productId, organizationId: organizationId! },
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

    const sale = await prisma.$transaction(async (tx) => {
      const newSale = await tx.sale.create({
        data: {
          totali,
          fitimi,
          shenime: shenime || null,
          paymentMethod: validPaymentMethod,
          organizationId: organizationId!,
          items: {
            create: await Promise.all(
              items.map(async (item: {
                productId: number
                emriProduktit: string
                sasia: number
                cmimiBlerjes: number
                cmimiShitjes: number
              }) => {
                const product = await tx.product.findFirst({
                  where: { id: item.productId, organizationId: organizationId! },
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

      for (const item of items) {
        await tx.product.updateMany({
          where: { id: item.productId, organizationId: organizationId! },
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

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const [shitjetSot, allProducts, shitjetRecente, topSaleItems] = await Promise.all([
      prisma.sale.findMany({
        where: { createdAt: { gte: today, lt: tomorrow } },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.findMany({ orderBy: { emri: 'asc' } }),
      prisma.sale.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { items: true },
      }),
      prisma.saleItem.groupBy({
        by: ['productId', 'emriProduktit'],
        _sum: { sasia: true },
        orderBy: { _sum: { sasia: 'desc' } },
        take: 5,
      }),
    ])

    const lowStockProducts = allProducts
      .filter((p) => p.sasia <= p.stokuMinimal)
      .sort((a, b) => a.sasia / a.stokuMinimal - b.sasia / b.stokuMinimal)
      .slice(0, 8)

    const shitjetSotTotali = shitjetSot.reduce((sum, s) => sum + s.totali, 0)
    const fititmiSot = shitjetSot.reduce((sum, s) => sum + s.fitimi, 0)
    const produkteShitura = shitjetSot.reduce(
      (sum, s) => sum + s.items.reduce((is, i) => is + i.sasia, 0),
      0
    )

    return NextResponse.json({
      shitjetSotTotali,
      fititmiSot,
      produkteShitura,
      numriShitjeve: shitjetSot.length,
      produktetTotal: allProducts.length,
      lowStockCount: lowStockProducts.length,
      lowStockProducts,
      shitjetRecente,
      topProducts: topSaleItems,
    })
  } catch (error) {
    console.error('Dashboard error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

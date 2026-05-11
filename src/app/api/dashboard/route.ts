import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Build today's boundary in local timezone (matches how Historiku filters "sot")
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)

    const [shitjetSot, allProducts, shitjetRecente] = await Promise.all([
      prisma.sale.findMany({
        where: { createdAt: { gte: todayStart, lt: tomorrowStart } },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.findMany({ orderBy: { emri: 'asc' } }),
      prisma.sale.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { items: true },
      }),
    ])

    // Run groupBy separately so a failure here doesn't zero out all stats
    const topSaleItems = await prisma.saleItem
      .groupBy({
        by: ['productId', 'emriProduktit'],
        _sum: { sasia: true },
        orderBy: { _sum: { sasia: 'desc' } },
        take: 5,
      })
      .catch((e: unknown) => {
        console.error('Dashboard groupBy error:', e)
        return []
      })

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

    console.log(`Dashboard: todayStart=${todayStart.toISOString()}, tomorrowStart=${tomorrowStart.toISOString()}, shitjetSot=${shitjetSot.length}`)

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

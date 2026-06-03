import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'

export const dynamic = 'force-dynamic'

const MONTH_NAMES = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj']

export async function GET(request: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('dashboard:read')
  if (error) return error

  const rl = rateLimit(request, 'dashboard', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

  try {
    const { searchParams } = new URL(request.url)
    const periudha = searchParams.get('periudha') || 'sot'
    const ngaParam = searchParams.get('nga')
    const deriParam = searchParams.get('deri')

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
    const last30Start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0)
    const last12Start = new Date(now.getFullYear(), now.getMonth() - 11, 1, 0, 0, 0, 0)
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0)
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0)

    let periodStart: Date
    let periodEnd: Date = tomorrowStart
    switch (periudha) {
      case 'jave':
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0)
        break
      case 'muaj':
        periodStart = monthStart
        break
      case 'custom':
        periodStart = ngaParam ? new Date(ngaParam) : monthStart
        if (deriParam) {
          const d = new Date(deriParam)
          d.setHours(23, 59, 59, 999)
          periodEnd = d
        }
        break
      default:
        periodStart = todayStart
    }

    const orgFilter = { organizationId: organizationId! }

    const [
      periodSales,
      monthSales,
      todaySalesRaw,
      allProducts,
      suppliersCount,
      chartDailyRaw,
      chartMonthlyRaw,
      prevMonthSales,
      yesterdaySales,
      topPeriodProducts,
      recentSales,
      cashPeriudhaAgg,
      bankPeriudhaAgg,
    ] = await Promise.all([
      prisma.sale.findMany({
        where: { ...orgFilter, createdAt: { gte: periodStart, lt: periodEnd } },
        select: { totali: true, fitimi: true, items: { select: { sasia: true } } },
      }),
      prisma.sale.findMany({
        where: { ...orgFilter, createdAt: { gte: monthStart, lt: tomorrowStart } },
        select: { totali: true, fitimi: true },
      }),
      prisma.sale.findMany({
        where: { ...orgFilter, createdAt: { gte: todayStart, lt: tomorrowStart } },
        select: { totali: true, fitimi: true },
      }),
      prisma.product.findMany({
        where: orgFilter,
        select: { id: true, emri: true, sasia: true, stokuMinimal: true, kategoria: true },
        orderBy: { emri: 'asc' },
      }),
      prisma.supplier.count({ where: orgFilter }),
      prisma.sale.findMany({
        where: { ...orgFilter, createdAt: { gte: last30Start, lt: tomorrowStart } },
        select: { totali: true, fitimi: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.sale.findMany({
        where: { ...orgFilter, createdAt: { gte: last12Start, lt: tomorrowStart } },
        select: { totali: true, fitimi: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.sale.findMany({
        where: { ...orgFilter, createdAt: { gte: prevMonthStart, lt: monthStart } },
        select: { totali: true },
      }),
      prisma.sale.findMany({
        where: { ...orgFilter, createdAt: { gte: yesterdayStart, lt: todayStart } },
        select: { totali: true },
      }),
      prisma.saleItem
        .groupBy({
          by: ['productId', 'emriProduktit'],
          where: { sale: { ...orgFilter, createdAt: { gte: periodStart, lt: periodEnd } } },
          _sum: { sasia: true, fitimi: true },
          orderBy: { _sum: { sasia: 'desc' } },
          take: 8,
        })
        .catch(() => []),
      prisma.sale.findMany({
        where: orgFilter,
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { items: true },
      }),
      prisma.sale.aggregate({
        where: { ...orgFilter, createdAt: { gte: periodStart, lt: periodEnd }, paymentMethod: 'cash' },
        _sum: { totali: true },
      }),
      prisma.sale.aggregate({
        where: { ...orgFilter, createdAt: { gte: periodStart, lt: periodEnd }, paymentMethod: 'bank' },
        _sum: { totali: true },
      }),
    ])

    const periudhaTotali = periodSales.reduce((s, x) => s + x.totali, 0)
    const periudhaFitimi = periodSales.reduce((s, x) => s + x.fitimi, 0)
    const periudhaNumri = periodSales.length
    const periudhaProdukte = periodSales.reduce(
      (s, x) => s + x.items.reduce((is, i) => is + i.sasia, 0),
      0
    )

    const shitjetSotTotali = todaySalesRaw.reduce((s, x) => s + x.totali, 0)
    const shitjetMuajitTotali = monthSales.reduce((s, x) => s + x.totali, 0)
    const shitjetMuajitFitimi = monthSales.reduce((s, x) => s + x.fitimi, 0)

    const lowStockProducts = allProducts
      .filter((p) => p.sasia <= p.stokuMinimal)
      .sort((a, b) => a.sasia / a.stokuMinimal - b.sasia / b.stokuMinimal)
      .slice(0, 8)

    const dailyMap = new Map<string, { shitjet: number; fitimi: number }>()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
      dailyMap.set(key, { shitjet: 0, fitimi: 0 })
    }
    for (const sale of chartDailyRaw) {
      const d = new Date(sale.createdAt)
      const key = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
      const entry = dailyMap.get(key)
      if (entry) {
        entry.shitjet += sale.totali
        entry.fitimi += sale.fitimi
      }
    }
    const chartDitor = Array.from(dailyMap.entries()).map(([data, v]) => ({
      data,
      shitjet: Math.round(v.shitjet),
      fitimi: Math.round(v.fitimi),
    }))

    const monthlyMap = new Map<string, { muaj: string; shitjet: number; fitimi: number }>()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      monthlyMap.set(key, { muaj: MONTH_NAMES[d.getMonth()], shitjet: 0, fitimi: 0 })
    }
    for (const sale of chartMonthlyRaw) {
      const d = new Date(sale.createdAt)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const entry = monthlyMap.get(key)
      if (entry) {
        entry.shitjet += sale.totali
        entry.fitimi += sale.fitimi
      }
    }
    const chartMujor = Array.from(monthlyMap.values()).map((v) => ({
      muaj: v.muaj,
      shitjet: Math.round(v.shitjet),
      fitimi: Math.round(v.fitimi),
    }))

    const topProducts = topPeriodProducts.map((p) => ({
      emri: p.emriProduktit,
      njesi: p._sum.sasia ?? 0,
      fitimi: Math.round(p._sum.fitimi ?? 0),
    }))

    const insights: Array<{ type: 'success' | 'warning' | 'info'; text: string }> = []

    if (topProducts.length > 0) {
      insights.push({
        type: 'info',
        text: `Produkti më i shitur: "${topProducts[0].emri}" (${topProducts[0].njesi} njësi)`,
      })
    }

    for (const p of lowStockProducts.slice(0, 2)) {
      insights.push({ type: 'warning', text: `Stoku po mbaron për ${p.emri} (${p.sasia} njësi të mbetura)` })
    }

    const prevMonthTotal = prevMonthSales.reduce((s, x) => s + x.totali, 0)
    if (prevMonthTotal > 0 && shitjetMuajitTotali > 0) {
      const diff = ((shitjetMuajitTotali - prevMonthTotal) / prevMonthTotal) * 100
      if (Math.abs(diff) >= 5) {
        const dir = diff > 0 ? 'rritur' : 'ulur'
        insights.push({
          type: diff > 0 ? 'success' : 'warning',
          text: `Shitjet janë ${dir} ${Math.abs(diff).toFixed(0)}% krahasuar me muajin e kaluar`,
        })
      }
    }

    const yesterdayTotal = yesterdaySales.reduce((s, x) => s + x.totali, 0)
    if (yesterdayTotal > 0 && shitjetSotTotali > 0) {
      const diff = ((shitjetSotTotali - yesterdayTotal) / yesterdayTotal) * 100
      if (Math.abs(diff) >= 10) {
        insights.push({
          type: diff > 0 ? 'success' : 'info',
          text: `Sot ${Math.abs(diff).toFixed(0)}% ${diff > 0 ? 'më shumë' : 'më pak'} shitje se dje`,
        })
      }
    }

    return NextResponse.json({
      periudhaTotali,
      periudhaFitimi,
      periudhaNumri,
      periudhaProdukte,
      shitjetSotTotali,
      shitjetMuajitTotali,
      shitjetMuajitFitimi,
      produktetTotal: allProducts.length,
      lowStockCount: lowStockProducts.length,
      lowStockProducts,
      furnitoretTotal: suppliersCount,
      chartDitor,
      chartMujor,
      topProducts,
      shitjetRecente: recentSales,
      insights,
      cashPeriudha: cashPeriudhaAgg._sum.totali ?? 0,
      bankPeriudha: bankPeriudhaAgg._sum.totali ?? 0,
    })
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/dashboard', action: 'GET' })
    console.error('Dashboard error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import {
  businessDayLabel,
  businessMonthKey,
  endOfBusinessDateExclusive,
  startOfBusinessDate,
  startOfBusinessDay,
  startOfBusinessDayOffset,
  startOfBusinessMonth,
} from '@/lib/business-time'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { CACHE_TTL, cached, orgTag } from '@/lib/cache'

export const dynamic = 'force-dynamic'

const MONTH_NAMES = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj']

async function buildDashboard(
  organizationId: number,
  periudha: string,
  ngaParam: string | null,
  deriParam: string | null,
) {
  // Every boundary below is a business-day boundary in the market's timezone,
  // not the server's, so the figures an owner reconciles against the till do
  // not shift when the runtime is UTC.
  const now = new Date()
  const todayStart = startOfBusinessDay(now)
  const tomorrowStart = startOfBusinessDayOffset(now, 1)
  const monthStart = startOfBusinessMonth(now)
  const last30Start = startOfBusinessDayOffset(now, -29)
  const last12Start = startOfBusinessMonth(now, 11)
  const prevMonthStart = startOfBusinessMonth(now, 1)
  const yesterdayStart = startOfBusinessDayOffset(now, -1)

  let periodStart: Date
  let periodEnd: Date = tomorrowStart
  switch (periudha) {
    case 'jave':
      periodStart = startOfBusinessDayOffset(now, -6)
      break
    case 'muaj':
      periodStart = monthStart
      break
    case 'custom':
      periodStart = (ngaParam ? startOfBusinessDate(ngaParam) : null) ?? monthStart
      if (deriParam) {
        // Half-open: the day after the one requested, so the whole final day is
        // included without depending on a 23:59:59.999 sentinel.
        periodEnd = endOfBusinessDateExclusive(deriParam) ?? tomorrowStart
      }
      break
    default:
      periodStart = todayStart
  }

  const orgFilter = { organizationId }
  const periodFilter = { ...orgFilter, createdAt: { gte: periodStart, lt: periodEnd } }

  const [
    periodAgg,
    periodItemsAgg,
    periodByPaymentMethod,
    monthAgg,
    allProducts,
    suppliersCount,
    chartDailyRaw,
    chartMonthlyRaw,
    prevMonthAgg,
    topPeriodProducts,
    recentSales,
  ] = await Promise.all([
    // Period totals are computed in the database instead of transferring every
    // sale row (and its items) for the period and reducing them in Node.
    prisma.sale.aggregate({
      where: periodFilter,
      _count: { _all: true },
      _sum: { totali: true, fitimi: true },
    }),
    prisma.saleItem.aggregate({
      where: { sale: periodFilter },
      _sum: { sasia: true },
    }),
    // One grouped query replaces the separate cash and bank aggregates.
    prisma.sale.groupBy({
      by: ['paymentMethod'],
      where: periodFilter,
      _sum: { totali: true },
    }),
    prisma.sale.aggregate({
      where: { ...orgFilter, createdAt: { gte: monthStart, lt: tomorrowStart } },
      _sum: { totali: true, fitimi: true },
    }),
    prisma.product.findMany({
      where: { ...orgFilter, isArchived: false },
      select: { id: true, emri: true, sasia: true, stokuMinimal: true, kategoria: true },
      orderBy: { emri: 'asc' },
    }),
    prisma.supplier.count({ where: orgFilter }),
    // The charts bucket sales by the server's local calendar day, which the
    // database cannot reproduce without assuming a timezone — so these two keep
    // returning rows. Today's and yesterday's totals are derived from this same
    // window rather than queried again.
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
    prisma.sale.aggregate({
      where: { ...orgFilter, createdAt: { gte: prevMonthStart, lt: monthStart } },
      _sum: { totali: true },
    }),
    prisma.saleItem
      .groupBy({
        by: ['productId', 'emriProduktit'],
        where: { sale: periodFilter },
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
  ])

  const periudhaTotali = periodAgg._sum.totali ?? 0
  const periudhaFitimi = periodAgg._sum.fitimi ?? 0
  const periudhaNumri = periodAgg._count._all
  const periudhaProdukte = periodItemsAgg._sum.sasia ?? 0

  const cashPeriudha =
    periodByPaymentMethod.find((g) => g.paymentMethod === 'cash')?._sum.totali ?? 0
  const bankPeriudha =
    periodByPaymentMethod.find((g) => g.paymentMethod === 'bank')?._sum.totali ?? 0

  // todayStart and yesterdayStart always fall inside the 30-day chart window,
  // so both totals come from rows that are already loaded.
  let shitjetSotTotali = 0
  let yesterdayTotal = 0
  for (const sale of chartDailyRaw) {
    if (sale.createdAt >= todayStart) shitjetSotTotali += sale.totali
    else if (sale.createdAt >= yesterdayStart) yesterdayTotal += sale.totali
  }

  const shitjetMuajitTotali = monthAgg._sum.totali ?? 0
  const shitjetMuajitFitimi = monthAgg._sum.fitimi ?? 0

  const lowStockProducts = allProducts
    .filter((p) => p.sasia <= p.stokuMinimal)
    .sort((a, b) => a.sasia / a.stokuMinimal - b.sasia / b.stokuMinimal)
    .slice(0, 8)

  const dailyMap = new Map<string, { shitjet: number; fitimi: number }>()
  for (let i = 29; i >= 0; i--) {
    dailyMap.set(businessDayLabel(startOfBusinessDayOffset(now, -i)), { shitjet: 0, fitimi: 0 })
  }
  for (const sale of chartDailyRaw) {
    // The bucket a sale falls in is decided by the market's clock, matching the
    // boundaries the totals above were computed with.
    const key = businessDayLabel(sale.createdAt)
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
    const { key, monthIndex } = businessMonthKey(startOfBusinessMonth(now, i))
    monthlyMap.set(key, { muaj: MONTH_NAMES[monthIndex], shitjet: 0, fitimi: 0 })
  }
  for (const sale of chartMonthlyRaw) {
    const entry = monthlyMap.get(businessMonthKey(sale.createdAt).key)
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

  const prevMonthTotal = prevMonthAgg._sum.totali ?? 0
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

  if (yesterdayTotal > 0 && shitjetSotTotali > 0) {
    const diff = ((shitjetSotTotali - yesterdayTotal) / yesterdayTotal) * 100
    if (Math.abs(diff) >= 10) {
      insights.push({
        type: diff > 0 ? 'success' : 'info',
        text: `Sot ${Math.abs(diff).toFixed(0)}% ${diff > 0 ? 'më shumë' : 'më pak'} shitje se dje`,
      })
    }
  }

  return {
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
    cashPeriudha,
    bankPeriudha,
  }
}

async function handleGet(request: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('dashboard:read')
  if (error) return error

  const rl = rateLimit(request, 'dashboard', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(request, 'Abonimi ka skaduar', 403)

  try {
    const { searchParams } = new URL(request.url)
    const periudha = searchParams.get('periudha') || 'sot'
    const ngaParam = searchParams.get('nga')
    const deriParam = searchParams.get('deri')

    // The payload is identical for every user in the organization who can read
    // the dashboard, so it is cached per org and per selected period. Any sale,
    // product or supplier write in this org evicts it immediately.
    const payload = await cached(
      {
        namespace: 'dashboard',
        organizationId: organizationId!,
        variant: `${periudha}|${ngaParam ?? ''}|${deriParam ?? ''}`,
        ttlMs: CACHE_TTL.dashboard,
        tags: [
          orgTag(organizationId!, 'sales'),
          orgTag(organizationId!, 'products'),
          orgTag(organizationId!, 'suppliers'),
        ],
      },
      () => buildDashboard(organizationId!, periudha, ngaParam, deriParam),
    )

    return NextResponse.json(payload)
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/dashboard', action: 'GET' })
    console.error('Dashboard error:', error)
    return errorResponse(request, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/dashboard', handleGet)

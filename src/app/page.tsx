'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import {
  RiMoneyDollarCircleLine,
  RiLineChartLine,
  RiShoppingBagLine,
  RiAlertLine,
  RiArrowRightLine,
  RiBox3Line,
  RiTruckLine,
  RiCalendarLine,
  RiCheckLine,
  RiInformationLine,
  RiErrorWarningLine,
  RiRefreshLine,
  RiArrowUpLine,
  RiArrowDownLine,
  RiFileListLine,
} from 'react-icons/ri'

const DailySalesChart = dynamic(
  () => import('@/components/ui/DashboardCharts').then((m) => m.DailySalesChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
const MonthlySalesChart = dynamic(
  () => import('@/components/ui/DashboardCharts').then((m) => m.MonthlySalesChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
const TopProductsChart = dynamic(
  () => import('@/components/ui/DashboardCharts').then((m) => m.TopProductsChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)

function ChartSkeleton() {
  return (
    <div className="h-48 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

type Periudha = 'sot' | 'jave' | 'muaj' | 'custom'

interface LowStockProduct {
  id: number
  emri: string
  sasia: number
  stokuMinimal: number
  kategoria: string
}

interface RecentSale {
  id: number
  totali: number
  fitimi: number
  createdAt: string
  items: Array<{ emriProduktit: string; sasia: number }>
}

interface DashboardData {
  periudhaTotali: number
  periudhaFitimi: number
  periudhaNumri: number
  periudhaProdukte: number
  shitjetSotTotali: number
  shitjetMuajitTotali: number
  shitjetMuajitFitimi: number
  produktetTotal: number
  lowStockCount: number
  lowStockProducts: LowStockProduct[]
  furnitoretTotal: number
  chartDitor: Array<{ data: string; shitjet: number; fitimi: number }>
  chartMujor: Array<{ muaj: string; shitjet: number; fitimi: number }>
  topProducts: Array<{ emri: string; njesi: number; fitimi: number }>
  shitjetRecente: RecentSale[]
  insights: Array<{ type: 'success' | 'warning' | 'info'; text: string }>
}

const PERIOD_LABELS: Record<Periudha, string> = {
  sot: 'Sot',
  jave: 'Kjo Javë',
  muaj: 'Ky Muaj',
  custom: 'Periudhë Tjatër',
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.3, ease: 'easeOut' },
  }),
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [periudha, setPeriudha] = useState<Periudha>('sot')
  const [nga, setNga] = useState('')
  const [deri, setDeri] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  const fetchDashboard = useCallback(
    (p: Periudha = periudha, silent = false) => {
      if (!silent) setLoading(true)
      else setRefreshing(true)

      const params = new URLSearchParams({ periudha: p })
      if (p === 'custom' && nga) params.set('nga', nga)
      if (p === 'custom' && deri) params.set('deri', deri)

      fetch(`/api/dashboard?${params}`)
        .then((r) => r.json())
        .then((d) => {
          setData(d)
          setLoading(false)
          setRefreshing(false)
        })
        .catch(() => {
          setLoading(false)
          setRefreshing(false)
        })
    },
    [periudha, nga, deri]
  )

  useEffect(() => {
    fetchDashboard(periudha, false)
  }, [periudha]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onFocus = () => fetchDashboard(periudha, true)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchDashboard(periudha, true)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchDashboard, periudha])

  const handlePeriodChange = (p: Periudha) => {
    setPeriudha(p)
    setShowCustom(p === 'custom')
  }

  const sot = new Date().toLocaleDateString('sq-AL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  if (loading) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded-lg w-56" />
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 w-28 bg-slate-200 rounded-full" />
            ))}
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-28 bg-slate-200 rounded-2xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-64 bg-slate-200 rounded-2xl" />
            <div className="h-64 bg-slate-200 rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  const periodLabel = PERIOD_LABELS[periudha]

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Paneli Kryesor</h1>
          <p className="text-sm text-slate-400 mt-0.5 capitalize">{sot}</p>
        </div>
        <button
          onClick={() => fetchDashboard(periudha, true)}
          className="btn-secondary flex items-center gap-2 self-start"
        >
          <RiRefreshLine className={refreshing ? 'animate-spin' : ''} />
          Rifresko
        </button>
      </div>

      {/* Period filter */}
      <div className="flex flex-wrap gap-2 items-center">
        {(['sot', 'jave', 'muaj', 'custom'] as Periudha[]).map((p) => (
          <button
            key={p}
            onClick={() => handlePeriodChange(p)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-150 ${
              periudha === p
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}

        <AnimatePresence>
          {showCustom && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex items-center gap-2 flex-wrap"
            >
              <input
                type="date"
                value={nga}
                onChange={(e) => setNga(e.target.value)}
                className="input !w-auto text-sm"
              />
              <span className="text-slate-400 text-sm">deri</span>
              <input
                type="date"
                value={deri}
                onChange={(e) => setDeri(e.target.value)}
                className="input !w-auto text-sm"
              />
              <button
                onClick={() => fetchDashboard('custom', false)}
                className="btn-primary"
              >
                Kërko
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 6 KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <KpiCard
          index={0}
          title={`Shitjet ${periodLabel}`}
          value={formatCurrency(data?.periudhaTotali ?? 0)}
          sub={`${data?.periudhaNumri ?? 0} shitje`}
          icon={<RiMoneyDollarCircleLine />}
          color="blue"
        />
        <KpiCard
          index={1}
          title="Shitjet Sot"
          value={formatCurrency(data?.shitjetSotTotali ?? 0)}
          sub="të ardhura ditore"
          icon={<RiCalendarLine />}
          color="indigo"
        />
        <KpiCard
          index={2}
          title="Fitimi i Muajit"
          value={formatCurrency(data?.shitjetMuajitFitimi ?? 0)}
          sub={`nga ${formatCurrency(data?.shitjetMuajitTotali ?? 0)} shitje`}
          icon={<RiLineChartLine />}
          color="emerald"
          trend={
            data && data.shitjetMuajitTotali > 0
              ? {
                  value: `${((data.shitjetMuajitFitimi / data.shitjetMuajitTotali) * 100).toFixed(1)}% marzh`,
                  positive: true,
                }
              : undefined
          }
        />
        <KpiCard
          index={3}
          title="Gjithsej Produkte"
          value={data?.produktetTotal ?? 0}
          sub="në inventar"
          icon={<RiBox3Line />}
          color="violet"
        />
        <KpiCard
          index={4}
          title="Stok i Ulët"
          value={data?.lowStockCount ?? 0}
          sub={`nga ${data?.produktetTotal ?? 0} produkte`}
          icon={<RiAlertLine />}
          color={data?.lowStockCount && data.lowStockCount > 0 ? 'red' : 'emerald'}
        />
        <KpiCard
          index={5}
          title="Gjithsej Furnitorë"
          value={data?.furnitoretTotal ?? 0}
          sub="partnere aktiv"
          icon={<RiTruckLine />}
          color="amber"
        />
      </div>

      {/* Reorder suggestions card */}
      {(data?.lowStockCount ?? 0) > 0 && (
        <motion.div variants={fadeUp} custom={6} initial="hidden" animate="show">
          <Link
            href="/porositje-te-sugjeruara"
            className="card flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors group border-l-4 border-l-amber-400"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <RiFileListLine className="text-amber-600 text-xl" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">Produkte për Porosi</p>
                <p className="text-sm text-slate-400">
                  {data!.lowStockCount} produkte kanë nevojë për porosi — shiko sugjerimet sipas furnitorit
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 ml-3">
              <span className="inline-flex items-center justify-center min-w-[2rem] h-8 px-2.5 bg-amber-100 text-amber-700 text-sm font-bold rounded-full">
                {data!.lowStockCount}
              </span>
              <RiArrowRightLine className="text-slate-400 group-hover:text-blue-600 transition-colors text-lg" />
            </div>
          </Link>
        </motion.div>
      )}

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div variants={fadeUp} custom={6} initial="hidden" animate="show" className="card">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Shitjet Ditore</h2>
            <p className="text-xs text-slate-400 mt-0.5">30 ditët e fundit</p>
          </div>
          <div className="p-4 pt-5">
            <DailySalesChart data={data?.chartDitor ?? []} />
          </div>
        </motion.div>

        <motion.div variants={fadeUp} custom={7} initial="hidden" animate="show" className="card">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Shitjet Mujore</h2>
            <p className="text-xs text-slate-400 mt-0.5">12 muajt e fundit</p>
          </div>
          <div className="p-4 pt-5">
            <MonthlySalesChart data={data?.chartMujor ?? []} />
          </div>
        </motion.div>
      </div>

      {/* Charts Row 2 + Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top products chart */}
        <motion.div
          variants={fadeUp}
          custom={8}
          initial="hidden"
          animate="show"
          className="card lg:col-span-2"
        >
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Produktet Më të Shitura</h2>
              <p className="text-xs text-slate-400 mt-0.5">{periodLabel}</p>
            </div>
            <span className="badge-purple">{data?.topProducts?.length ?? 0} produkte</span>
          </div>
          <div className="p-4 pt-5">
            <TopProductsChart data={data?.topProducts ?? []} />
          </div>
        </motion.div>

        {/* Business insights */}
        <motion.div
          variants={fadeUp}
          custom={9}
          initial="hidden"
          animate="show"
          className="card"
        >
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Njohuri Biznesi</h2>
            <p className="text-xs text-slate-400 mt-0.5">Analiza automatike</p>
          </div>
          <div className="p-4 space-y-3">
            {data?.insights && data.insights.length > 0 ? (
              data.insights.map((ins, i) => (
                <InsightItem key={i} type={ins.type} text={ins.text} />
              ))
            ) : (
              <div className="py-8 text-center">
                <RiInformationLine className="text-3xl text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Nuk ka njohuri aktualisht</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Low stock bars */}
      {data?.lowStockProducts && data.lowStockProducts.length > 0 && (
        <motion.div variants={fadeUp} custom={10} initial="hidden" animate="show" className="card">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-slate-900">Stok i Ulët</h2>
              <span className="badge-red">{data.lowStockCount}</span>
            </div>
            <Link
              href="/stok-i-ulet"
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              Shiko listën <RiArrowRightLine />
            </Link>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {data.lowStockProducts.map((p) => {
              const pct = Math.min(100, Math.round((p.sasia / Math.max(p.stokuMinimal, 1)) * 100))
              const color = pct <= 25 ? 'bg-red-500' : pct <= 60 ? 'bg-amber-400' : 'bg-emerald-400'
              return (
                <div key={p.id} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 truncate pr-2">{p.emri}</span>
                    <span className="text-xs text-slate-400 whitespace-nowrap">{p.sasia}/{p.stokuMinimal}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, delay: 0.1 }}
                      className={`h-full rounded-full ${color}`}
                    />
                  </div>
                  <p className="text-xs text-slate-400">{p.kategoria}</p>
                </div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Recent sales */}
      <motion.div variants={fadeUp} custom={11} initial="hidden" animate="show" className="card">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Shitjet e Fundit</h2>
          <Link
            href="/historiku"
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
          >
            Shiko të gjitha <RiArrowRightLine />
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {data?.shitjetRecente && data.shitjetRecente.length > 0 ? (
            data.shitjetRecente.map((sale) => (
              <div
                key={sale.id}
                className="px-5 py-3.5 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">Shitje #{sale.id}</p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      {sale.items.slice(0, 2).map((i) => i.emriProduktit).join(', ')}
                      {sale.items.length > 2 ? ` +${sale.items.length - 2}` : ''}
                    </p>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {formatCurrency(sale.totali)}
                    </p>
                    <p className="text-xs text-emerald-600 font-medium">
                      {formatCurrency(sale.fitimi)} fitim
                    </p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-1">{formatDateTime(sale.createdAt)}</p>
              </div>
            ))
          ) : (
            <div className="px-5 py-8 text-center">
              <RiShoppingBagLine className="text-3xl text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Nuk ka shitje të fundit</p>
              <Link href="/shitjet" className="btn-primary mt-3 inline-flex">
                Regjistro shitje
              </Link>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

type KpiColor = 'blue' | 'indigo' | 'emerald' | 'violet' | 'red' | 'amber'

const kpiColorMap: Record<KpiColor, { bg: string; icon: string; border: string }> = {
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600', border: 'border-l-blue-500' },
  indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-600', border: 'border-l-indigo-500' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', border: 'border-l-emerald-500' },
  violet: { bg: 'bg-violet-50', icon: 'text-violet-600', border: 'border-l-violet-500' },
  red: { bg: 'bg-red-50', icon: 'text-red-600', border: 'border-l-red-500' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600', border: 'border-l-amber-500' },
}

interface KpiCardProps {
  index: number
  title: string
  value: string | number
  sub: string
  icon: React.ReactNode
  color: KpiColor
  trend?: { value: string; positive: boolean }
}

function KpiCard({ index, title, value, sub, icon, color, trend }: KpiCardProps) {
  const c = kpiColorMap[color]
  return (
    <motion.div
      variants={fadeUp}
      custom={index}
      initial="hidden"
      animate="show"
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
      className={`card p-5 border-l-4 ${c.border}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide truncate">
            {title}
          </p>
          <p className="text-2xl font-bold text-slate-900 mt-1.5">{value}</p>
          <p className="text-xs text-slate-400 mt-1">{sub}</p>
          {trend && (
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium mt-2 px-2 py-0.5 rounded-full ${
                trend.positive
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {trend.positive ? <RiArrowUpLine /> : <RiArrowDownLine />}
              {trend.value}
            </span>
          )}
        </div>
        <div
          className={`w-11 h-11 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0 ml-4`}
        >
          <span className={`text-xl ${c.icon}`}>{icon}</span>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Insight Item ─────────────────────────────────────────────────────────────

const insightStyles = {
  success: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    icon: <RiCheckLine className="text-emerald-600" />,
    text: 'text-emerald-800',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: <RiErrorWarningLine className="text-amber-600" />,
    text: 'text-amber-800',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: <RiInformationLine className="text-blue-600" />,
    text: 'text-blue-800',
  },
}

function InsightItem({ type, text }: { type: 'success' | 'warning' | 'info'; text: string }) {
  const s = insightStyles[type]
  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border ${s.bg} ${s.border}`}>
      <span className="flex-shrink-0 mt-0.5 text-base">{s.icon}</span>
      <p className={`text-xs font-medium leading-relaxed ${s.text}`}>{text}</p>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import StatsCard from '@/components/ui/StatsCard'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import {
  RiMoneyDollarCircleLine,
  RiLineChartLine,
  RiShoppingBagLine,
  RiAlertLine,
  RiArrowRightLine,
  RiBox3Line,
} from 'react-icons/ri'

interface DashboardData {
  shitjetSotTotali: number
  fititmiSot: number
  produkteShitura: number
  numriShitjeve: number
  produktetTotal: number
  lowStockCount: number
  lowStockProducts: Array<{
    id: number
    emri: string
    sasia: number
    stokuMinimal: number
    kategoria: string
  }>
  shitjetRecente: Array<{
    id: number
    totali: number
    fitimi: number
    createdAt: string
    items: Array<{ emriProduktit: string; sasia: number }>
  }>
  topProducts: Array<{
    productId: number
    emriProduktit: string
    _sum: { sasia: number | null }
  }>
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchDashboard = () => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    fetchDashboard()

    // Refetch when user returns to this tab (e.g. after completing a sale in /shitjet)
    const onFocus = () => fetchDashboard()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchDashboard()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const sot = new Date().toLocaleDateString('sq-AL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded w-64" />
          <div className="grid grid-cols-4 gap-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-28 bg-slate-200 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Paneli Kryesor</h1>
        <p className="text-sm text-slate-500 mt-0.5 capitalize">{sot}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatsCard
          title="Shitjet Sot"
          value={formatCurrency(data?.shitjetSotTotali ?? 0)}
          subtitle={`${data?.numriShitjeve ?? 0} shitje të kryera`}
          icon={<RiMoneyDollarCircleLine />}
          color="blue"
        />
        <StatsCard
          title="Fitimi Sot"
          value={formatCurrency(data?.fititmiSot ?? 0)}
          subtitle="Fitim neto i ditës"
          icon={<RiLineChartLine />}
          color="green"
        />
        <StatsCard
          title="Produkte të Shitura"
          value={data?.produkteShitura ?? 0}
          subtitle="Njësi sot"
          icon={<RiShoppingBagLine />}
          color="purple"
        />
        <StatsCard
          title="Stok i Ulët"
          value={data?.lowStockCount ?? 0}
          subtitle={`Nga ${data?.produktetTotal ?? 0} produkte gjithsej`}
          icon={<RiAlertLine />}
          color={data?.lowStockCount && data.lowStockCount > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Recent Sales */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card"
        >
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Shitjet e Fundit</h2>
            <Link href="/historiku" className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              Shiko të gjitha <RiArrowRightLine />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {data?.shitjetRecente && data.shitjetRecente.length > 0 ? (
              data.shitjetRecente.map((sale) => (
                <div key={sale.id} className="px-5 py-3.5 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        Shitje #{sale.id}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {sale.items.slice(0, 2).map(i => i.emriProduktit).join(', ')}
                        {sale.items.length > 2 ? ` +${sale.items.length - 2}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">{formatCurrency(sale.totali)}</p>
                      <p className="text-xs text-green-600 font-medium">{formatCurrency(sale.fitimi)} fitim</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{formatDateTime(sale.createdAt)}</p>
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-slate-400">Nuk ka shitje sot</p>
                <Link href="/shitjet" className="btn-primary mt-3 inline-flex">
                  Regjistro shitje
                </Link>
              </div>
            )}
          </div>
        </motion.div>

        {/* Low Stock Alert */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="card"
        >
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">
              Stok i Ulët
              {data?.lowStockCount && data.lowStockCount > 0 ? (
                <span className="ml-2 badge-red">{data.lowStockCount}</span>
              ) : null}
            </h2>
            <Link href="/stok-i-ulet" className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              Shiko listën <RiArrowRightLine />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {data?.lowStockProducts && data.lowStockProducts.length > 0 ? (
              data.lowStockProducts.map((product) => (
                <div key={product.id} className="px-5 py-3.5 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{product.emri}</p>
                      <p className="text-xs text-slate-400">{product.kategoria}</p>
                    </div>
                    <div className="text-right">
                      <span className="badge-red">{product.sasia} njësi</span>
                      <p className="text-xs text-slate-400 mt-1">Min: {product.stokuMinimal}</p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center">
                <RiBox3Line className="text-3xl text-green-400 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Të gjitha produktet kanë stok të mjaftueshëm</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Top Products */}
      {data?.topProducts && data.topProducts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="card"
        >
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Produktet Më të Shitura</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th">#</th>
                  <th className="table-th">Produkti</th>
                  <th className="table-th text-right">Njësi të Shitura</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((item, idx) => (
                  <tr key={item.productId} className="table-row">
                    <td className="table-td font-semibold text-slate-400">{idx + 1}</td>
                    <td className="table-td font-medium">{item.emriProduktit}</td>
                    <td className="table-td text-right font-semibold">{item._sum.sasia ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import PageHeader from '@/components/ui/PageHeader'
import { formatDateTime } from '@/lib/utils'
import { getPlanInfo, getStatusInfo } from '@/lib/billing'
import {
  RiGlobalLine,
  RiBuildingLine,
  RiTeamLine,
  RiShoppingBasketLine,
  RiShoppingCartLine,
  RiMoneyDollarCircleLine,
  RiBellLine,
  RiFileSearchLine,
  RiRefreshLine,
  RiTimeLine,
  RiCoinLine,
  RiCheckLine,
  RiTimerLine,
  RiCloseCircleLine,
} from 'react-icons/ri'

// ─── Types ───────────────────────────────────────────────────────────────────

interface OrgSubscription {
  plan: string
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  canceledAt: string | null
}

interface OrgRow {
  id: number
  name: string
  usersCount: number
  productsCount: number
  salesCount: number
  lastActivity: string | null
  createdAt: string
  subscription: OrgSubscription | null
}

interface BillingKPIs {
  trial: number
  active: number
  past_due: number
  canceled: number
  expired: number
}

interface PlatformStats {
  totalOrganizations: number
  totalUsers: number
  totalProducts: number
  totalSales: number
  totalRevenue: number
  totalNotifications: number
  totalAuditLogs: number
  billing: BillingKPIs
  organizations: OrgRow[]
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: string }) {
  const info = getPlanInfo(plan)
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${info.color}`}>
      {info.label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const info = getStatusInfo(status)
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${info.color}`}>
      {info.label}
    </span>
  )
}

// ─── Stat card (reused for both platform and billing KPIs) ────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  delay,
}: {
  label: string
  value: string | number
  icon: React.ElementType
  color: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="card p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-slate-500 font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="text-base" />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-800">
        {typeof value === 'number' ? value.toLocaleString('sq-AL') : value}
      </p>
    </motion.div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlatformaPage() {
  const { role } = useRole()
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/platform')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setStats(data)
      setLastRefresh(new Date())
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  if (!role || role !== 'platform_owner') return <AccessDenied />

  const platformCards = stats
    ? [
        { label: 'Organizata Gjithsej', value: stats.totalOrganizations, icon: RiBuildingLine, color: 'bg-blue-100 text-blue-600' },
        { label: 'Përdorues Gjithsej', value: stats.totalUsers, icon: RiTeamLine, color: 'bg-violet-100 text-violet-600' },
        { label: 'Produkte Gjithsej', value: stats.totalProducts, icon: RiShoppingBasketLine, color: 'bg-orange-100 text-orange-600' },
        { label: 'Shitje Gjithsej', value: stats.totalSales, icon: RiShoppingCartLine, color: 'bg-emerald-100 text-emerald-600' },
        {
          label: 'Të Ardhura Totale',
          value: `${stats.totalRevenue.toLocaleString('sq-AL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} L`,
          icon: RiMoneyDollarCircleLine,
          color: 'bg-green-100 text-green-600',
        },
        { label: 'Njoftime Gjithsej', value: stats.totalNotifications, icon: RiBellLine, color: 'bg-yellow-100 text-yellow-600' },
        { label: 'Regjistrime Auditimi', value: stats.totalAuditLogs, icon: RiFileSearchLine, color: 'bg-slate-100 text-slate-600' },
      ]
    : []

  const billingCards = stats
    ? [
        { label: 'Aktiv', value: stats.billing.active, icon: RiCheckLine, color: 'bg-green-100 text-green-600' },
        { label: 'Në Provë', value: stats.billing.trial, icon: RiTimerLine, color: 'bg-yellow-100 text-yellow-600' },
        { label: 'Me Vonesë', value: stats.billing.past_due, icon: RiCoinLine, color: 'bg-orange-100 text-orange-600' },
        { label: 'Anuluar', value: stats.billing.canceled, icon: RiCloseCircleLine, color: 'bg-red-100 text-red-600' },
        { label: 'Skaduar', value: stats.billing.expired, icon: RiGlobalLine, color: 'bg-slate-100 text-slate-500' },
      ]
    : []

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <PageHeader
          title="Platforma SaaS"
          subtitle="Pamje e agreguar e të gjitha organizatave"
        />
        <button
          onClick={fetchStats}
          disabled={loading}
          className="btn-secondary flex items-center gap-2 mt-1"
        >
          <RiRefreshLine className={`text-base ${loading ? 'animate-spin' : ''}`} />
          Rifresko
        </button>
      </div>

      {lastRefresh && (
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-5">
          <RiTimeLine />
          <span>Rifreskuar: {formatDateTime(lastRefresh)}</span>
        </div>
      )}

      {loading && !stats ? (
        <div className="py-20 text-center">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Duke ngarkuar statistikat e platformës...</p>
        </div>
      ) : !stats ? (
        <div className="py-20 text-center">
          <RiGlobalLine className="text-4xl text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">Nuk mund të ngarkohen të dhënat</p>
        </div>
      ) : (
        <>
          {/* Platform KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
            {platformCards.map((card, idx) => (
              <StatCard key={card.label} {...card} delay={idx * 0.05} />
            ))}
          </div>

          {/* Billing KPI section */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.36 }}
            className="mb-7"
          >
            <div className="flex items-center gap-2 mb-3">
              <RiCoinLine className="text-slate-400 text-base" />
              <h2 className="text-sm font-semibold text-slate-700">Abonimet</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {billingCards.map((card, idx) => (
                <StatCard key={card.label} {...card} delay={0.38 + idx * 0.04} />
              ))}
            </div>
          </motion.div>

          {/* Organizations table */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.56 }}
          >
            <div className="flex items-center gap-2 mb-3">
              <RiBuildingLine className="text-slate-400 text-base" />
              <h2 className="text-sm font-semibold text-slate-700">
                Organizatat ({stats.organizations.length})
              </h2>
            </div>

            <div className="card overflow-hidden">
              {stats.organizations.length === 0 ? (
                <div className="p-12 text-center">
                  <RiBuildingLine className="text-4xl text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-400 font-medium">Nuk ka organizata të regjistruara</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="table-th">#</th>
                        <th className="table-th">Organizata</th>
                        <th className="table-th">Plani</th>
                        <th className="table-th">Statusi</th>
                        <th className="table-th">Skadon</th>
                        <th className="table-th text-right">Përdorues</th>
                        <th className="table-th text-right">Produkte</th>
                        <th className="table-th text-right">Shitje</th>
                        <th className="table-th">Aktiviteti i Fundit</th>
                        <th className="table-th">Krijuar më</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.organizations.map((org, idx) => {
                        const sub = org.subscription
                        const expiryDate = sub?.status === 'trial'
                          ? sub.trialEndsAt
                          : (sub?.status === 'active' || sub?.status === 'past_due')
                            ? sub.currentPeriodEnd
                            : null

                        return (
                          <motion.tr
                            key={org.id}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.58 + idx * 0.04 }}
                            className="table-row"
                          >
                            <td className="table-td">
                              <span className="text-slate-400 text-xs font-mono">#{org.id}</span>
                            </td>
                            <td className="table-td">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                  <RiBuildingLine className="text-blue-600 text-sm" />
                                </div>
                                <span className="font-semibold text-slate-800 text-sm">{org.name}</span>
                              </div>
                            </td>
                            <td className="table-td">
                              {sub ? <PlanBadge plan={sub.plan} /> : <span className="text-xs text-slate-300 italic">—</span>}
                            </td>
                            <td className="table-td">
                              {sub ? <StatusBadge status={sub.status} /> : <span className="text-xs text-slate-300 italic">—</span>}
                            </td>
                            <td className="table-td">
                              {expiryDate ? (
                                <span className="text-xs text-slate-600">
                                  {formatDateTime(new Date(expiryDate))}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-300 italic">—</span>
                              )}
                            </td>
                            <td className="table-td text-right">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">
                                <RiTeamLine className="text-xs" />
                                {org.usersCount}
                              </span>
                            </td>
                            <td className="table-td text-right">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
                                <RiShoppingBasketLine className="text-xs" />
                                {org.productsCount}
                              </span>
                            </td>
                            <td className="table-td text-right">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                                <RiShoppingCartLine className="text-xs" />
                                {org.salesCount}
                              </span>
                            </td>
                            <td className="table-td">
                              {org.lastActivity ? (
                                <span className="text-xs text-slate-600">
                                  {formatDateTime(new Date(org.lastActivity))}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-300 italic">Pa aktivitet</span>
                              )}
                            </td>
                            <td className="table-td">
                              <span className="text-xs text-slate-500">
                                {formatDateTime(new Date(org.createdAt))}
                              </span>
                            </td>
                          </motion.tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}

    </div>
  )
}

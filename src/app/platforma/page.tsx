'use client'

/**
 * Platform Owner — Overview.
 *
 * The operational landing page: portfolio totals, the lifecycle breakdown, the
 * most urgent alerts, and a way in. The organization table that used to live
 * here moved to /platforma/organizatat, where it can carry search, filters and
 * paging without crowding the summary.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import PlatformShell from '@/components/platform/PlatformShell'
import { SeverityBadge } from '@/components/platform/StateBadge'
import Modal from '@/components/ui/Modal'
import ErrorState from '@/components/ui/ErrorState'
import { formatDateTime } from '@/lib/utils'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import type { OrgStateKind } from '@/lib/org-state'
import type { AlertSeverity, PlatformAlert } from '@/lib/platform-alerts'
import {
  RiBuildingLine,
  RiTeamLine,
  RiShoppingBasketLine,
  RiShoppingCartLine,
  RiMoneyDollarCircleLine,
  RiBellLine,
  RiFileSearchLine,
  RiRefreshLine,
  RiTimeLine,
  RiAddLine,
  RiLoader4Line,
  RiUserSettingsLine,
  RiArrowRightLine,
  RiAlarmWarningLine,
} from 'react-icons/ri'

interface Overview {
  totalOrganizations: number
  totalUsers: number
  totalStaff: number
  totalProducts: number
  totalSales: number
  totalRevenue: number
  salesLast30Days: number
  revenueLast30Days: number
  totalNotifications: number
  totalAuditLogs: number
  stateCounts: Record<OrgStateKind, number>
  alertCounts: Record<AlertSeverity, number>
  alertsTotal: number
  topAlerts: PlatformAlert[]
}

const STATE_SUMMARY: { kind: OrgStateKind; label: string; color: string }[] = [
  { kind: 'active',          label: 'Aktiv',                 color: 'bg-green-100 text-green-700'   },
  { kind: 'trialing',        label: 'Provë',                 color: 'bg-yellow-100 text-yellow-700' },
  { kind: 'cancelling',      label: 'Anulim i planifikuar',  color: 'bg-orange-100 text-orange-700' },
  { kind: 'cancelled',       label: 'Anuluar',               color: 'bg-red-100 text-red-700'       },
  { kind: 'trial_expired',   label: 'Provë e skaduar',       color: 'bg-slate-100 text-slate-500'   },
  { kind: 'expired',         label: 'Skaduar',               color: 'bg-slate-100 text-slate-500'   },
  { kind: 'suspended',       label: 'Pezulluar',             color: 'bg-red-100 text-red-700'       },
  { kind: 'no_subscription', label: 'Pa abonim',             color: 'bg-slate-100 text-slate-500'   },
]

function StatCard({
  label, value, hint, icon: Icon, color, delay,
}: {
  label: string
  value: string | number
  hint?: string
  icon: React.ElementType
  color: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
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
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </motion.div>
  )
}

export default function PlatformOverviewPage() {
  const orgIdempotency = useIdempotencyKey()

  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const [creatingOrg, setCreatingOrg] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/platform')
      if (res.status === 401) throw new Error('Sesioni ka skaduar. Hyr sërish.')
      if (res.status === 403) throw new Error('Nuk ke akses te paneli i platformës.')
      if (!res.ok) throw new Error('Statistikat nuk u ngarkuan dot. Provo sërish.')
      setData(await res.json())
      setLastRefresh(new Date())
    } catch (e) {
      setData(null)
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createOrg() {
    const name = newOrgName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/platform/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...orgIdempotency.headers() },
        body: JSON.stringify({ name }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Gabim')
      orgIdempotency.reset()
      toast.success(`Marketi "${name}" u krijua`)
      setCreatingOrg(false)
      setNewOrgName('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gabim gjatë krijimit')
    } finally {
      setCreating(false)
    }
  }

  const cards = data
    ? [
        { label: 'Organizata', value: data.totalOrganizations, hint: `${data.stateCounts.active} aktive`, icon: RiBuildingLine, color: 'bg-blue-100 text-blue-600' },
        { label: 'Përdorues', value: data.totalUsers, hint: `${data.totalStaff} staf me PIN`, icon: RiTeamLine, color: 'bg-violet-100 text-violet-600' },
        { label: 'Produkte', value: data.totalProducts, icon: RiShoppingBasketLine, color: 'bg-orange-100 text-orange-600' },
        { label: 'Shitje', value: data.totalSales, hint: `${data.salesLast30Days.toLocaleString('sq-AL')} në 30 ditë`, icon: RiShoppingCartLine, color: 'bg-emerald-100 text-emerald-600' },
        {
          label: 'Xhiro totale',
          value: `${data.totalRevenue.toLocaleString('sq-AL', { maximumFractionDigits: 0 })} L`,
          hint: `${data.revenueLast30Days.toLocaleString('sq-AL', { maximumFractionDigits: 0 })} L në 30 ditë`,
          icon: RiMoneyDollarCircleLine, color: 'bg-green-100 text-green-600',
        },
        { label: 'Njoftime', value: data.totalNotifications, icon: RiBellLine, color: 'bg-yellow-100 text-yellow-600' },
        { label: 'Auditim', value: data.totalAuditLogs, icon: RiFileSearchLine, color: 'bg-slate-100 text-slate-600' },
      ]
    : []

  return (
    <PlatformShell
      title="Platforma SaaS"
      subtitle="Pamje operative e të gjitha organizatave"
      action={
        <div className="flex items-center gap-2">
          <button onClick={() => { setCreatingOrg(true); setNewOrgName('') }} className="btn-primary flex items-center gap-2 whitespace-nowrap">
            <RiAddLine className="text-base" />
            Krijo Market
          </button>
          <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
            <RiRefreshLine className={`text-base ${loading ? 'animate-spin' : ''}`} />
            Rifresko
          </button>
        </div>
      }
    >
      {lastRefresh && !loadError && (
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-5">
          <RiTimeLine />
          <span>Rifreskuar: {formatDateTime(lastRefresh)}</span>
        </div>
      )}

      {loading && !data ? (
        <div className="py-20 text-center">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Duke ngarkuar statistikat e platformës...</p>
        </div>
      ) : loadError ? (
        <div className="card">
          <ErrorState message={loadError} onRetry={load} />
        </div>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
            {cards.map((card, idx) => (
              <StatCard key={card.label} {...card} delay={idx * 0.04} />
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
            {/* Lifecycle breakdown */}
            <motion.section
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="xl:col-span-2"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-700">Gjendja e portofolit</h2>
                <Link href="/platforma/organizatat" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  Të gjitha organizatat <RiArrowRightLine />
                </Link>
              </div>
              <div className="card p-4">
                <div className="flex flex-wrap gap-2">
                  {STATE_SUMMARY.filter(({ kind }) => (data.stateCounts[kind] ?? 0) > 0).map(
                    ({ kind, label, color }) => (
                      <Link
                        key={kind}
                        href={`/platforma/organizatat?state=${kind}`}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
                      >
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{label}</span>
                        <span className="text-sm font-bold text-slate-700">{data.stateCounts[kind]}</span>
                      </Link>
                    ),
                  )}
                  {data.totalOrganizations === 0 && (
                    <p className="text-sm text-slate-400 py-2">Nuk ka organizata të regjistruara</p>
                  )}
                </div>
              </div>
            </motion.section>

            {/* Attention queue */}
            <motion.section
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.36 }}
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <RiAlarmWarningLine className="text-slate-400" />
                  Kërkojnë vëmendje
                </h2>
                <Link href="/platforma/sinjalizime" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  Të gjitha ({data.alertsTotal}) <RiArrowRightLine />
                </Link>
              </div>
              <div className="card p-4">
                {data.topAlerts.length === 0 ? (
                  <p className="text-sm text-slate-400 py-2">Asgjë nuk kërkon vëmendje tani.</p>
                ) : (
                  <div className="space-y-2">
                    {data.topAlerts.map((alert) => (
                      <Link
                        key={`${alert.organizationId}-${alert.kind}`}
                        href={`/platforma/organizatat/${alert.organizationId}`}
                        className="block p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-sm font-medium text-slate-800 truncate">
                            {alert.organizationName}
                          </span>
                          <SeverityBadge severity={alert.severity} />
                        </div>
                        <p className="text-xs text-slate-600">{alert.title}</p>
                        <p className="text-xs text-slate-400 truncate">{alert.detail}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </motion.section>
          </div>

          {/* Quick links */}
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
          >
            <QuickLink href="/platforma/organizatat" icon={RiBuildingLine} title="Organizatat"
              detail="Kërko, filtro dhe menaxho çdo market" />
            <QuickLink href="/platforma/perdoruesit" icon={RiUserSettingsLine} title="Përdoruesit"
              detail={`${data.totalUsers} llogari · ${data.totalStaff} staf me PIN`} />
            <QuickLink href="/platforma/abonimet" icon={RiMoneyDollarCircleLine} title="Abonimet"
              detail="Prova, skadime dhe anulime" />
            <QuickLink href="/platforma/regjistri" icon={RiFileSearchLine} title="Auditimi"
              detail={`${data.totalAuditLogs.toLocaleString('sq-AL')} veprime të regjistruara`} />
          </motion.div>
        </>
      )}

      <Modal isOpen={creatingOrg} onClose={() => setCreatingOrg(false)} title="Krijo Market të Ri" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Emri i Marketit</label>
            <input
              type="text"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createOrg() }}
              placeholder="p.sh. Market Tirana 2"
              autoFocus
              className="input w-full"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Marketi krijohet me një provë 14-ditore. Përdoruesit shtohen nga faqja e organizatës.
            </p>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={createOrg}
              disabled={!newOrgName.trim() || creating}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {creating ? <RiLoader4Line className="animate-spin" /> : <RiAddLine />}
              Krijo
            </button>
            <button onClick={() => setCreatingOrg(false)} className="btn-secondary flex-1">
              Anulo
            </button>
          </div>
        </div>
      </Modal>
    </PlatformShell>
  )
}

function QuickLink({
  href, icon: Icon, title, detail,
}: { href: string; icon: React.ElementType; title: string; detail: string }) {
  return (
    <Link href={href} className="card p-4 hover:shadow-md transition-shadow group">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center transition-colors flex-shrink-0">
          <Icon className="text-slate-500 group-hover:text-blue-600 transition-colors" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-xs text-slate-400 truncate">{detail}</p>
        </div>
      </div>
    </Link>
  )
}

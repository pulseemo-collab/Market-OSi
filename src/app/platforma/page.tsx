'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import PageHeader from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import { formatDateTime } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/roles'
import toast from 'react-hot-toast'
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
  RiAddLine,
  RiToggleLine,
  RiToggleFill,
  RiUserLine,
  RiLoader4Line,
  RiLockLine,
} from 'react-icons/ri'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrgRow {
  id: number
  name: string
  isActive: boolean
  usersCount: number
  productsCount: number
  salesCount: number
  lastActivity: string | null
  createdAt: string
}

interface PlatformStats {
  totalOrganizations: number
  totalUsers: number
  totalProducts: number
  totalSales: number
  totalRevenue: number
  totalNotifications: number
  totalAuditLogs: number
  organizations: OrgRow[]
}

interface UserEntry {
  id: number
  userId: string
  email: string
  roli: string
  createdAt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, color, delay,
}: { label: string; value: string | number; icon: React.ElementType; color: string; delay: number }) {
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
    </motion.div>
  )
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-blue-100 text-blue-700',
  manager: 'bg-violet-100 text-violet-700',
  cashier: 'bg-emerald-100 text-emerald-700',
  employee: 'bg-slate-100 text-slate-600',
  platform_owner: 'bg-amber-100 text-amber-700',
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlatformaPage() {
  const { role } = useRole()

  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // Create org modal
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')
  const [creating, setCreating] = useState(false)

  // Toggle active
  const [togglingOrgId, setTogglingOrgId] = useState<number | null>(null)

  // Users modal
  const [usersOrgId, setUsersOrgId] = useState<number | null>(null)
  const [usersOrgName, setUsersOrgName] = useState('')
  const [users, setUsers] = useState<UserEntry[]>([])
  const [usersLoading, setUsersLoading] = useState(false)

  // ─── Fetch stats ──────────────────────────────────────────────────────────

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

  useEffect(() => { fetchStats() }, [fetchStats])

  // ─── Create org ───────────────────────────────────────────────────────────

  async function createOrg() {
    const name = newOrgName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/platform/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gabim')
      toast.success(`Marketi "${name}" u krijua`)
      setCreatingOrg(false)
      setNewOrgName('')
      fetchStats()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gabim gjatë krijimit')
    } finally {
      setCreating(false)
    }
  }

  // ─── Toggle org active ────────────────────────────────────────────────────

  async function toggleOrg(org: OrgRow) {
    setTogglingOrgId(org.id)
    try {
      const res = await fetch(`/api/platform/organizations/${org.id}`, { method: 'PATCH' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gabim')
      const label = data.organization.isActive ? 'aktivizuar' : 'çaktivizuar'
      toast.success(`"${org.name}" u ${label}`)
      fetchStats()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gabim gjatë ndryshimit')
    } finally {
      setTogglingOrgId(null)
    }
  }

  // ─── Open users modal ─────────────────────────────────────────────────────

  async function openUsers(org: OrgRow) {
    setUsersOrgId(org.id)
    setUsersOrgName(org.name)
    setUsers([])
    setUsersLoading(true)
    try {
      const res = await fetch(`/api/platform/organizations/${org.id}/users`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gabim')
      setUsers(data.users)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
      setUsersOrgId(null)
    } finally {
      setUsersLoading(false)
    }
  }

  // ─── Guard ────────────────────────────────────────────────────────────────

  if (!role || role !== 'platform_owner') return <AccessDenied />

  const platformCards = stats
    ? [
        { label: 'Organizata', value: stats.totalOrganizations, icon: RiBuildingLine, color: 'bg-blue-100 text-blue-600' },
        { label: 'Përdorues', value: stats.totalUsers, icon: RiTeamLine, color: 'bg-violet-100 text-violet-600' },
        { label: 'Produkte', value: stats.totalProducts, icon: RiShoppingBasketLine, color: 'bg-orange-100 text-orange-600' },
        { label: 'Shitje', value: stats.totalSales, icon: RiShoppingCartLine, color: 'bg-emerald-100 text-emerald-600' },
        {
          label: 'Të Ardhura',
          value: `${stats.totalRevenue.toLocaleString('sq-AL', { maximumFractionDigits: 0 })} L`,
          icon: RiMoneyDollarCircleLine, color: 'bg-green-100 text-green-600',
        },
        { label: 'Njoftime', value: stats.totalNotifications, icon: RiBellLine, color: 'bg-yellow-100 text-yellow-600' },
        { label: 'Auditim', value: stats.totalAuditLogs, icon: RiFileSearchLine, color: 'bg-slate-100 text-slate-600' },
      ]
    : []

  return (
    <div className="p-4 sm:p-6 lg:p-8">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <PageHeader title="Platforma SaaS" subtitle="Pamje e agreguar e të gjitha organizatave" />
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={() => { setCreatingOrg(true); setNewOrgName('') }}
            className="btn-primary flex items-center gap-2"
          >
            <RiAddLine className="text-base" />
            Krijo Market
          </button>
          <button onClick={fetchStats} disabled={loading} className="btn-secondary flex items-center gap-2">
            <RiRefreshLine className={`text-base ${loading ? 'animate-spin' : ''}`} />
            Rifresko
          </button>
        </div>
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

          {/* Billing placeholder */}
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.36 }}
            className="mb-7"
          >
            <div className="flex items-center gap-2 mb-3">
              <RiCoinLine className="text-slate-400 text-base" />
              <h2 className="text-sm font-semibold text-slate-700">Abonimet</h2>
            </div>
            <div className="card p-5 flex items-center gap-3 text-slate-400">
              <RiLockLine className="text-xl flex-shrink-0" />
              <span className="text-sm">Abonimet do të aktivizohen në një hap tjetër.</span>
            </div>
          </motion.div>

          {/* Organizations table */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.44 }}>
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
                        <th className="table-th text-right">Përdorues</th>
                        <th className="table-th text-right">Produkte</th>
                        <th className="table-th text-right">Shitje</th>
                        <th className="table-th">Aktiviteti i Fundit</th>
                        <th className="table-th">Krijuar më</th>
                        <th className="table-th text-center">Veprimet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.organizations.map((org, idx) => {
                        const isToggling = togglingOrgId === org.id
                        return (
                          <motion.tr
                            key={org.id}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.46 + idx * 0.04 }}
                            className={`table-row transition-opacity ${!org.isActive ? 'opacity-50' : ''}`}
                          >
                            <td className="table-td">
                              <span className="text-slate-400 text-xs font-mono">#{org.id}</span>
                            </td>
                            <td className="table-td">
                              <div className="flex items-center gap-2">
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${org.isActive ? 'bg-blue-100' : 'bg-slate-100'}`}>
                                  <RiBuildingLine className={`text-sm ${org.isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-800 text-sm">{org.name}</span>
                                  {!org.isActive && (
                                    <span className="ml-2 text-xs text-red-400 font-medium">çaktivizuar</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="table-td text-right">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">
                                <RiTeamLine className="text-xs" />{org.usersCount}
                              </span>
                            </td>
                            <td className="table-td text-right">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
                                <RiShoppingBasketLine className="text-xs" />{org.productsCount}
                              </span>
                            </td>
                            <td className="table-td text-right">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                                <RiShoppingCartLine className="text-xs" />{org.salesCount}
                              </span>
                            </td>
                            <td className="table-td">
                              {org.lastActivity ? (
                                <span className="text-xs text-slate-600">{formatDateTime(new Date(org.lastActivity))}</span>
                              ) : (
                                <span className="text-xs text-slate-300 italic">Pa aktivitet</span>
                              )}
                            </td>
                            <td className="table-td">
                              <span className="text-xs text-slate-500">{formatDateTime(new Date(org.createdAt))}</span>
                            </td>
                            <td className="table-td">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => openUsers(org)}
                                  title="Shiko përdoruesit"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                                >
                                  <RiUserLine className="text-base" />
                                </button>
                                <button
                                  onClick={() => toggleOrg(org)}
                                  disabled={isToggling}
                                  title={org.isActive ? 'Çaktivizo' : 'Aktivizo'}
                                  className={`p-1.5 rounded-lg transition-colors ${
                                    org.isActive
                                      ? 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                                      : 'text-slate-400 hover:text-green-600 hover:bg-green-50'
                                  }`}
                                >
                                  {isToggling
                                    ? <RiLoader4Line className="text-base animate-spin" />
                                    : org.isActive
                                      ? <RiToggleFill className="text-base" />
                                      : <RiToggleLine className="text-base" />
                                  }
                                </button>
                              </div>
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

      {/* ── Create Org Modal ─────────────────────────────────────────────────── */}
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

      {/* ── Users Modal ──────────────────────────────────────────────────────── */}
      <Modal
        isOpen={usersOrgId !== null}
        onClose={() => { setUsersOrgId(null); setUsers([]) }}
        title={`Përdoruesit — ${usersOrgName}`}
        size="md"
      >
        {usersLoading ? (
          <div className="py-10 flex justify-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="py-10 text-center">
            <RiTeamLine className="text-4xl text-slate-200 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">Nuk ka përdorues në këtë organizatë</p>
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <RiUserLine className="text-blue-600 text-sm" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{u.email}</p>
                    <p className="text-xs text-slate-400">{formatDateTime(new Date(u.createdAt))}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[u.roli] ?? 'bg-slate-100 text-slate-600'}`}>
                  {ROLE_LABELS[u.roli as keyof typeof ROLE_LABELS] ?? u.roli}
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>

    </div>
  )
}

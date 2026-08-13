'use client'

/**
 * Platform Owner — Organizations.
 *
 * A management surface rather than a wall of icon buttons: search, state and
 * plan filters, sortable columns, paging, and exactly one primary action per
 * row. Everything an operator can *do* to a tenant now lives inside that
 * tenant's Control Center, where each action can carry its own explanation.
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import PlatformShell from '@/components/platform/PlatformShell'
import { StateBadge } from '@/components/platform/StateBadge'
import ErrorState from '@/components/ui/ErrorState'
import { formatDateTime } from '@/lib/utils'
import { getPlanInfo } from '@/lib/billing'
import type { OrgStateKind } from '@/lib/org-state'
import {
  ORG_SORT_LABELS, type OrgSortKey, type OrgStateFilter,
} from '@/lib/platform-orgs'
import {
  RiBuildingLine, RiSearchLine, RiArrowUpSLine, RiArrowDownSLine,
  RiArrowLeftSLine, RiArrowRightSLine, RiRefreshLine, RiSettings3Line, RiCloseLine,
} from 'react-icons/ri'

interface Row {
  id: number
  name: string
  isActive: boolean
  usersCount: number
  staffCount: number
  productsCount: number
  salesCount: number
  lastActivity: string | null
  createdAt: string
  subscription: {
    plan: string
    status: string
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    nextPlan: string | null
    cancelAtPeriodEnd: boolean
    cancelledAt: string | null
  } | null
}

interface Payload {
  organizations: Row[]
  total: number
  truncated: boolean
  page: number
  pageSize: number
  totalPages: number
  stateCounts: Record<OrgStateKind, number>
}

const STATE_FILTERS: { value: OrgStateFilter; label: string }[] = [
  { value: 'all',             label: 'Të gjitha' },
  { value: 'attention',       label: 'Kërkojnë vëmendje' },
  { value: 'with_access',     label: 'Me akses' },
  { value: 'without_access',  label: 'Pa akses' },
  { value: 'active',          label: 'Aktiv' },
  { value: 'trialing',        label: 'Provë' },
  { value: 'cancelling',      label: 'Anulim i planifikuar' },
  { value: 'cancelled',       label: 'Anuluar' },
  { value: 'trial_expired',   label: 'Provë e skaduar' },
  { value: 'expired',         label: 'Skaduar' },
  { value: 'suspended',       label: 'Pezulluar' },
  { value: 'no_subscription', label: 'Pa abonim' },
]

const SORTABLE: OrgSortKey[] = ['name', 'state', 'users', 'products', 'sales', 'lastActivity', 'createdAt', 'entitlementEnd']

function OrganizationsInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [q, setQ] = useState('')
  const [state, setState] = useState<OrgStateFilter>(
    (searchParams.get('state') as OrgStateFilter) || 'all',
  )
  const [plan, setPlan] = useState('all')
  const [sort, setSort] = useState<OrgSortKey>('createdAt')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Debounced so typing in the search box does not issue a request per keystroke.
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({
        state, plan, sort, dir, page: String(page), pageSize: '25',
      })
      if (debouncedQ) params.set('q', debouncedQ)

      const res = await fetch(`/api/platform/organizations?${params}`)
      if (res.status === 401) throw new Error('Sesioni ka skaduar. Hyr sërish.')
      if (res.status === 403) throw new Error('Nuk ke akses te organizatat e platformës.')
      if (!res.ok) throw new Error('Lista nuk u ngarkua dot. Provo sërish.')
      setData(await res.json())
    } catch (e) {
      setData(null)
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [state, plan, sort, dir, page, debouncedQ])

  useEffect(() => { load() }, [load])

  function toggleSort(key: OrgSortKey) {
    if (sort === key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(key)
      setDir(key === 'name' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  function applyState(next: OrgStateFilter) {
    setState(next)
    setPage(1)
    // Keeps the URL shareable and makes the browser Back button behave.
    router.replace(next === 'all' ? '/platforma/organizatat' : `/platforma/organizatat?state=${next}`)
  }

  const plans = Array.from(
    new Set((data?.organizations ?? []).map((o) => o.subscription?.plan).filter(Boolean) as string[]),
  )

  return (
    <PlatformShell
      title="Organizatat"
      subtitle={
        data
          ? `${data.total.toLocaleString('sq-AL')} organizata në filtrin aktual`
          : 'Kërko, filtro dhe menaxho çdo market'
      }
      action={
        <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
          <RiRefreshLine className={`text-base ${loading ? 'animate-spin' : ''}`} />
          Rifresko
        </button>
      }
    >
      {/* Filter bar */}
      <div className="card p-4 mb-5 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Kërko sipas emrit ose ID..."
              className="input w-full pl-9 pr-8 text-sm"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600"
                aria-label="Pastro"
              >
                <RiCloseLine />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <select
              value={plan}
              onChange={(e) => { setPlan(e.target.value); setPage(1) }}
              className="input text-sm"
              aria-label="Filtro sipas planit"
            >
              <option value="all">Të gjitha planet</option>
              {plans.map((p) => (
                <option key={p} value={p}>{getPlanInfo(p).label}</option>
              ))}
            </select>
            <select
              value={`${sort}:${dir}`}
              onChange={(e) => {
                const [s, d] = e.target.value.split(':')
                setSort(s as OrgSortKey)
                setDir(d as 'asc' | 'desc')
                setPage(1)
              }}
              className="input text-sm"
              aria-label="Rendit"
            >
              {SORTABLE.map((key) => (
                <optgroup key={key} label={ORG_SORT_LABELS[key]}>
                  <option value={`${key}:desc`}>{ORG_SORT_LABELS[key]} ↓</option>
                  <option value={`${key}:asc`}>{ORG_SORT_LABELS[key]} ↑</option>
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATE_FILTERS.map(({ value, label }) => {
            const count =
              value === 'all' || value === 'attention' || value === 'with_access' || value === 'without_access'
                ? null
                : (data?.stateCounts?.[value as OrgStateKind] ?? 0)
            if (count === 0) return null
            return (
              <button
                key={value}
                onClick={() => applyState(value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  state === value
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}{count !== null ? ` ${count}` : ''}
              </button>
            )
          })}
        </div>
      </div>

      {data?.truncated && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Lista është e kufizuar në organizatat më të reja. Përdorni kërkimin për të gjetur një market specifik.
        </div>
      )}

      <div className="card overflow-hidden">
        {loading && !data ? (
          <div className="py-16 text-center">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Duke ngarkuar organizatat...</p>
          </div>
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : !data || data.organizations.length === 0 ? (
          <div className="p-12 text-center">
            <RiBuildingLine className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">
              {debouncedQ || state !== 'all' || plan !== 'all'
                ? 'Asnjë organizatë nuk përputhet me filtrat'
                : 'Nuk ka organizata të regjistruara'}
            </p>
            {(debouncedQ || state !== 'all' || plan !== 'all') && (
              <button
                onClick={() => { setQ(''); setPlan('all'); applyState('all') }}
                className="btn-secondary mt-4 text-sm"
              >
                Pastro filtrat
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <SortableTh label="Organizata" sortKey="name" active={sort} dir={dir} onClick={toggleSort} />
                  <SortableTh label="Gjendja" sortKey="state" active={sort} dir={dir} onClick={toggleSort} />
                  <th className="table-th">Plani</th>
                  <SortableTh label="Përdorues" sortKey="users" active={sort} dir={dir} onClick={toggleSort} align="right" />
                  <SortableTh label="Produkte" sortKey="products" active={sort} dir={dir} onClick={toggleSort} align="right" />
                  <SortableTh label="Shitje" sortKey="sales" active={sort} dir={dir} onClick={toggleSort} align="right" />
                  <SortableTh label="Aktiviteti i fundit" sortKey="lastActivity" active={sort} dir={dir} onClick={toggleSort} />
                  <SortableTh label="Krijuar" sortKey="createdAt" active={sort} dir={dir} onClick={toggleSort} />
                  <th className="table-th text-right">Veprimi</th>
                </tr>
              </thead>
              <tbody>
                {data.organizations.map((org, idx) => (
                  <motion.tr
                    key={org.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                    className="table-row"
                  >
                    <td className="table-td">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${org.isActive ? 'bg-blue-100' : 'bg-slate-100'}`}>
                          <RiBuildingLine className={`text-sm ${org.isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                        </div>
                        <div className="min-w-0">
                          {/* max-w keeps a very long market name from stretching
                              the table past the viewport on a laptop. */}
                          <p className="font-semibold text-slate-800 text-sm truncate max-w-[16rem]">{org.name}</p>
                          <p className="text-xs text-slate-400 font-mono">#{org.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-td"><StateBadge org={org} showDetail /></td>
                    <td className="table-td">
                      {org.subscription ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getPlanInfo(org.subscription.plan).color}`}>
                            {getPlanInfo(org.subscription.plan).label}
                          </span>
                          {org.subscription.nextPlan && (
                            <>
                              <span className="text-xs text-slate-400">→</span>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getPlanInfo(org.subscription.nextPlan).color}`}>
                                {getPlanInfo(org.subscription.nextPlan).label}
                              </span>
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300 italic">—</span>
                      )}
                    </td>
                    <td className="table-td text-right">
                      <span className="text-sm text-slate-700">{org.usersCount}</span>
                      {org.staffCount > 0 && (
                        <span className="text-xs text-slate-400"> +{org.staffCount} staf</span>
                      )}
                    </td>
                    <td className="table-td text-right text-sm text-slate-700">{org.productsCount}</td>
                    <td className="table-td text-right text-sm text-slate-700">{org.salesCount}</td>
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
                    <td className="table-td text-right">
                      <Link
                        href={`/platforma/organizatat/${org.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-blue-100 hover:text-blue-700 transition-colors whitespace-nowrap"
                      >
                        <RiSettings3Line />
                        Menaxho
                      </Link>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">
              Faqja {data.page} nga {data.totalPages}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={data.page <= 1 || loading}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Faqja e mëparshme"
              >
                <RiArrowLeftSLine className="text-lg" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={data.page >= data.totalPages || loading}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Faqja tjetër"
              >
                <RiArrowRightSLine className="text-lg" />
              </button>
            </div>
          </div>
        )}
      </div>
    </PlatformShell>
  )
}

function SortableTh({
  label, sortKey, active, dir, onClick, align = 'left',
}: {
  label: string
  sortKey: OrgSortKey
  active: OrgSortKey
  dir: 'asc' | 'desc'
  onClick: (key: OrgSortKey) => void
  align?: 'left' | 'right'
}) {
  const isActive = active === sortKey
  return (
    <th className={`table-th ${align === 'right' ? 'text-right' : ''}`}>
      <button
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-0.5 hover:text-slate-700 transition-colors ${isActive ? 'text-slate-700' : ''}`}
      >
        {label}
        {isActive && (dir === 'asc' ? <RiArrowUpSLine /> : <RiArrowDownSLine />)}
      </button>
    </th>
  )
}

export default function OrganizationsPage() {
  return (
    <Suspense
      fallback={
        <div className="py-24 text-center">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      }
    >
      <OrganizationsInner />
    </Suspense>
  )
}

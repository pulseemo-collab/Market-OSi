'use client'

/**
 * Platform Owner — global subscriptions.
 *
 * The same organization rows as /platforma/organizatat, grouped by lifecycle
 * state instead of listed flat, so the questions an operator actually asks —
 * which trials end this week, who cancelled their renewal, who has lapsed —
 * are answered by looking rather than by filtering.
 *
 * There is no second source of truth: the grouping comes from `resolveOrgState`
 * and the actions all live in each organization's Control Center.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import PlatformShell from '@/components/platform/PlatformShell'
import ErrorState from '@/components/ui/ErrorState'
import { getPlanInfo } from '@/lib/billing'
import { resolveOrgState, formatOrgDate, type OrgStateKind } from '@/lib/org-state'
import { RiCoinLine, RiRefreshLine, RiArrowRightSLine, RiTimeLine } from 'react-icons/ri'

interface Row {
  id: number
  name: string
  isActive: boolean
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

/** Presentation order: what needs a decision first, ordinary business last. */
const GROUPS: { kind: OrgStateKind; label: string; hint: string; color: string }[] = [
  { kind: 'cancelling',      label: 'Anulim i planifikuar', hint: 'Klienti ndaloi rinovimin; aksesi vazhdon deri në datën e treguar', color: 'border-orange-200 bg-orange-50' },
  { kind: 'trialing',        label: 'Në provë',             hint: 'Prova ende aktive',                                                color: 'border-yellow-200 bg-yellow-50' },
  { kind: 'trial_expired',   label: 'Provë e skaduar',      hint: 'Prova mbaroi pa u konvertuar',                                     color: 'border-slate-200 bg-slate-50' },
  { kind: 'expired',         label: 'Skaduar',              hint: 'Perioda e paguar mbaroi',                                          color: 'border-slate-200 bg-slate-50' },
  { kind: 'cancelled',       label: 'Anuluar',              hint: 'Abonimi është anuluar dhe aksesi ndërprerë',                        color: 'border-red-200 bg-red-50' },
  { kind: 'suspended',       label: 'Organizata e pezulluar', hint: 'Bllokim administrativ — i pavarur nga abonimi',                  color: 'border-red-200 bg-red-50' },
  { kind: 'no_subscription', label: 'Pa abonim',            hint: 'Asnjë abonim i regjistruar',                                       color: 'border-slate-200 bg-slate-50' },
  { kind: 'active',          label: 'Aktiv',                hint: 'Abonim i paguar që rinovohet normalisht',                          color: 'border-green-200 bg-green-50' },
]

function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return null
  return Math.ceil((t - Date.now()) / 86_400_000)
}

export default function PlatformSubscriptionsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // pageSize is the API maximum; the grouping needs the whole portfolio, and
      // the endpoint caps its own scan so this can never become unbounded.
      const res = await fetch('/api/platform/organizations?pageSize=100&sort=entitlementEnd&dir=asc')
      if (res.status === 401) throw new Error('Sesioni ka skaduar. Hyr sërish.')
      if (res.status === 403) throw new Error('Nuk ke akses te abonimet e platformës.')
      if (!res.ok) throw new Error('Abonimet nuk u ngarkuan dot. Provo sërish.')
      const body = await res.json()
      setRows(body.organizations ?? [])
    } catch (e) {
      setRows([])
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const byKind = rows.reduce((acc, row) => {
    const kind = resolveOrgState(row).kind
    ;(acc[kind] ??= []).push(row)
    return acc
  }, {} as Partial<Record<OrgStateKind, Row[]>>)

  // "Soon" is the one cross-cutting view: anything that loses or changes access
  // inside a fortnight, regardless of which group it sits in.
  const endingSoon = rows
    .map((row) => ({ row, state: resolveOrgState(row) }))
    .filter(({ state }) => {
      if (!state.hasAccess || !state.effectiveUntil) return false
      const d = daysUntil(state.effectiveUntil.toISOString())
      return d !== null && d <= 14
    })
    .sort((a, b) => (a.state.effectiveUntil!.getTime()) - (b.state.effectiveUntil!.getTime()))

  return (
    <PlatformShell
      title="Abonimet"
      subtitle={`${rows.length.toLocaleString('sq-AL')} organizata sipas gjendjes së abonimit`}
      action={
        <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
          <RiRefreshLine className={loading ? 'animate-spin' : ''} /> Rifresko
        </button>
      }
    >
      {loading && rows.length === 0 ? (
        <div className="py-16 text-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : loadError ? (
        <div className="card"><ErrorState message={loadError} onRetry={load} /></div>
      ) : rows.length === 0 ? (
        <div className="card p-12 text-center">
          <RiCoinLine className="text-4xl text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">Nuk ka abonime të regjistruara</p>
        </div>
      ) : (
        <div className="space-y-5">
          {endingSoon.length > 0 && (
            <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <RiTimeLine className="text-blue-600" />
                <h2 className="text-sm font-semibold text-blue-900">
                  Mbarojnë brenda 14 ditësh ({endingSoon.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {endingSoon.map(({ row, state }) => {
                  const d = daysUntil(state.effectiveUntil!.toISOString())
                  return (
                    <Link
                      key={row.id}
                      href={`/platforma/organizatat/${row.id}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white hover:bg-blue-100 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-slate-800 truncate">{row.name}</p>
                        <p className="text-xs text-slate-500">{state.label} · {formatOrgDate(state.effectiveUntil)}</p>
                      </div>
                      <span className="text-xs font-semibold text-blue-700 whitespace-nowrap">
                        {d !== null && d <= 0 ? 'sot' : `${d} ditë`}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {GROUPS.map(({ kind, label, hint, color }) => {
            const group = byKind[kind] ?? []
            if (group.length === 0) return null
            return (
              <section key={kind}>
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-sm font-semibold text-slate-700">
                    {label} <span className="text-slate-400 font-normal">({group.length})</span>
                  </h2>
                  <Link href={`/platforma/organizatat?state=${kind}`} className="text-xs text-blue-600 hover:text-blue-700">
                    Hap në listë
                  </Link>
                </div>
                <div className={`rounded-xl border ${color} p-3`}>
                  <p className="text-xs text-slate-500 mb-2">{hint}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {group.map((row) => {
                      const state = resolveOrgState(row)
                      return (
                        <Link
                          key={row.id}
                          href={`/platforma/organizatat/${row.id}`}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white hover:shadow-sm transition-shadow"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-slate-800 truncate">{row.name}</p>
                            <p className="text-xs text-slate-400 truncate">{state.detail}</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {row.subscription && (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getPlanInfo(row.subscription.plan).color}`}>
                                {getPlanInfo(row.subscription.plan).label}
                              </span>
                            )}
                            <RiArrowRightSLine className="text-slate-300" />
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </PlatformShell>
  )
}

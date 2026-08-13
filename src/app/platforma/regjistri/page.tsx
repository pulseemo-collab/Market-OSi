'use client'

/**
 * Platform Owner — cross-tenant audit.
 *
 * The only view in the product that reads audit entries across organizations.
 * It is gated on `global:audit`, which belongs to `platform_owner` alone; a
 * tenant Administrator's own /regjistri page is unchanged and still scoped to
 * their market.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import PlatformShell from '@/components/platform/PlatformShell'
import ErrorState from '@/components/ui/ErrorState'
import { formatDateTime } from '@/lib/utils'
import { RiFileSearchLine, RiRefreshLine, RiBuildingLine } from 'react-icons/ri'

interface AuditRow {
  id: number
  organizationId: number
  organizationName: string
  userEmail: string
  userRole: string
  action: string
  entityType: string
  entityId: string | null
  description: string
  createdAt: string
}

export default function PlatformAuditPage() {
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [actions, setActions] = useState<{ action: string; count: number }[]>([])
  const [entityTypes, setEntityTypes] = useState<string[]>([])

  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [actor, setActor] = useState('')
  const [orgId, setOrgId] = useState('')
  const [nga, setNga] = useState('')
  const [deri, setDeri] = useState('')
  const [page, setPage] = useState(1)

  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '50' })
      if (action) params.set('action', action)
      if (entityType) params.set('entityType', entityType)
      if (actor) params.set('actor', actor)
      if (orgId.trim()) params.set('organizationId', orgId.trim())
      if (nga) params.set('nga', nga)
      if (deri) params.set('deri', deri)

      const res = await fetch(`/api/platform/audit?${params}`)
      if (res.status === 400) throw new Error('Filtri i organizatës duhet të jetë një numër.')
      if (res.status === 401) throw new Error('Sesioni ka skaduar. Hyr sërish.')
      if (res.status === 403) throw new Error('Nuk ke akses te auditimi i platformës.')
      if (!res.ok) throw new Error('Auditimi nuk u ngarkua dot. Provo sërish.')
      const body = await res.json()
      setLogs(body.logs ?? [])
      setActions(body.actions ?? [])
      setEntityTypes(body.entityTypes ?? [])
      setTotal(body.total ?? 0)
      setTotalPages(body.totalPages ?? 1)
    } catch (e) {
      setLogs([])
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [page, action, entityType, actor, orgId, nga, deri])

  useEffect(() => { load() }, [load])

  const hasFilters = !!(action || entityType || actor || orgId || nga || deri)

  return (
    <PlatformShell
      title="Auditimi i platformës"
      subtitle={`${total.toLocaleString('sq-AL')} veprime në të gjitha organizatat`}
      action={
        <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
          <RiRefreshLine className={loading ? 'animate-spin' : ''} /> Rifresko
        </button>
      }
    >
      <div className="card p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} className="input text-sm">
            <option value="">Të gjitha veprimet</option>
            {actions.map((a) => (
              <option key={a.action} value={a.action}>{a.action} ({a.count})</option>
            ))}
          </select>
          <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1) }} className="input text-sm">
            <option value="">Të gjitha entitetet</option>
            {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            value={actor} onChange={(e) => { setActor(e.target.value); setPage(1) }}
            placeholder="Email i vepruesit" className="input text-sm"
          />
          <input
            value={orgId} onChange={(e) => { setOrgId(e.target.value); setPage(1) }}
            placeholder="ID e organizatës" inputMode="numeric" className="input text-sm"
          />
          <input type="date" value={nga} onChange={(e) => { setNga(e.target.value); setPage(1) }} className="input text-sm" aria-label="Nga data" />
          <input type="date" value={deri} onChange={(e) => { setDeri(e.target.value); setPage(1) }} className="input text-sm" aria-label="Deri më" />
        </div>
        {hasFilters && (
          <button
            onClick={() => {
              setAction(''); setEntityType(''); setActor(''); setOrgId(''); setNga(''); setDeri(''); setPage(1)
            }}
            className="btn-secondary text-xs mt-2"
          >
            Pastro filtrat
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <RiFileSearchLine className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">
              {hasFilters ? 'Asnjë veprim nuk përputhet me filtrat' : 'Nuk ka veprime të regjistruara'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th">Data</th>
                  <th className="table-th">Organizata</th>
                  <th className="table-th">Veprimi</th>
                  <th className="table-th">Përshkrimi</th>
                  <th className="table-th">Vepruesi</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="table-row">
                    <td className="table-td text-xs text-slate-500 whitespace-nowrap">
                      {formatDateTime(new Date(l.createdAt))}
                    </td>
                    <td className="table-td">
                      <Link
                        href={`/platforma/organizatat/${l.organizationId}`}
                        className="inline-flex items-center gap-1.5 text-sm text-slate-700 hover:text-blue-600 min-w-0"
                      >
                        <RiBuildingLine className="text-slate-300 flex-shrink-0" />
                        <span className="truncate max-w-[12rem]">{l.organizationName}</span>
                      </Link>
                    </td>
                    <td className="table-td">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 whitespace-nowrap">
                        {l.action}
                      </span>
                      <p className="text-xs text-slate-400 mt-0.5">{l.entityType}</p>
                    </td>
                    <td className="table-td">
                      <p className="text-sm text-slate-700 break-words max-w-md">{l.description}</p>
                    </td>
                    <td className="table-td">
                      <p className="text-xs text-slate-600 truncate max-w-[14rem]">{l.userEmail}</p>
                      <p className="text-xs text-slate-400">{l.userRole}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">Faqja {page} nga {totalPages}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-30">E mëparshme</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-30">Tjetra</button>
            </div>
          </div>
        )}
      </div>
    </PlatformShell>
  )
}

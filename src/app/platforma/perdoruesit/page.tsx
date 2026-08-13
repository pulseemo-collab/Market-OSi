'use client'

/**
 * Platform Owner — global user directory.
 *
 * An operational lookup across tenants, not a second identity system: nothing
 * here creates, merges or authenticates anyone. Email accounts and PIN staff are
 * listed separately because they are genuinely different kinds of account, and
 * every row names the organization it belongs to so two same-named cashiers in
 * different markets never blur together.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import PlatformShell from '@/components/platform/PlatformShell'
import ErrorState from '@/components/ui/ErrorState'
import { formatDateTime } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/roles'
import {
  RiSearchLine, RiTeamLine, RiUserLine, RiLockLine, RiRefreshLine,
  RiCloseLine, RiArrowRightSLine,
} from 'react-icons/ri'

interface DirectoryUser {
  id: number
  email: string
  roli: string
  createdAt: string
  organizationId: number
  organizationName: string
  organizationActive: boolean
}

interface DirectoryStaff {
  id: number
  emri: string
  kodi: string | null
  roli: string
  isActive: boolean
  isLocked: boolean
  createdAt: string
  organizationId: number
  organizationName: string
  organizationActive: boolean
}

const ROLE_COLORS: Record<string, string> = {
  Administrator: 'bg-blue-100 text-blue-700',
  Manager: 'bg-violet-100 text-violet-700',
  Cashier: 'bg-emerald-100 text-emerald-700',
  platform_owner: 'bg-amber-100 text-amber-700',
}

export default function PlatformUsersPage() {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [kind, setKind] = useState<'all' | 'users' | 'staff'>('all')
  const [page, setPage] = useState(1)

  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [staff, setStaff] = useState<DirectoryStaff[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [staffTotal, setStaffTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '50' })
      if (debouncedQ) params.set('q', debouncedQ)
      if (kind !== 'all') params.set('kind', kind)

      const res = await fetch(`/api/platform/users?${params}`)
      if (res.status === 401) throw new Error('Sesioni ka skaduar. Hyr sërish.')
      if (res.status === 403) throw new Error('Nuk ke akses te drejtoria e përdoruesve.')
      if (!res.ok) throw new Error('Përdoruesit nuk u ngarkuan dot. Provo sërish.')
      const body = await res.json()
      setUsers(body.users ?? [])
      setStaff(body.staff ?? [])
      setUsersTotal(body.usersTotal ?? 0)
      setStaffTotal(body.staffTotal ?? 0)
    } catch (e) {
      setUsers([]); setStaff([])
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [debouncedQ, kind, page])

  useEffect(() => { load() }, [load])

  const nothing = users.length === 0 && staff.length === 0

  return (
    <PlatformShell
      title="Përdoruesit"
      subtitle={`${usersTotal.toLocaleString('sq-AL')} llogari me email · ${staffTotal.toLocaleString('sq-AL')} staf me PIN`}
      action={
        <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
          <RiRefreshLine className={loading ? 'animate-spin' : ''} /> Rifresko
        </button>
      }
    >
      <div className="card p-4 mb-5 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Kërko sipas emailit, emrit, kodit ose organizatës..."
            className="input w-full pl-9 pr-8 text-sm"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Pastro"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600">
              <RiCloseLine />
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          {(['all', 'users', 'staff'] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setKind(k); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                kind === k ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {k === 'all' ? 'Të gjithë' : k === 'users' ? 'Me email' : 'Staf PIN'}
            </button>
          ))}
        </div>
      </div>

      {loading && nothing ? (
        <div className="py-16 text-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : loadError ? (
        <div className="card"><ErrorState message={loadError} onRetry={load} /></div>
      ) : nothing ? (
        <div className="card p-12 text-center">
          <RiTeamLine className="text-4xl text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">
            {debouncedQ ? `Asnjë rezultat për “${debouncedQ}”` : 'Nuk ka përdorues të regjistruar'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {kind !== 'staff' && users.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-700 mb-2">
                Llogari me email ({usersTotal.toLocaleString('sq-AL')})
              </h2>
              <div className="card overflow-hidden overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="table-th">Email</th>
                      <th className="table-th">Roli</th>
                      <th className="table-th">Organizata</th>
                      <th className="table-th">Krijuar</th>
                      <th className="table-th text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="table-row">
                        <td className="table-td">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                              <RiUserLine className="text-blue-600 text-sm" />
                            </div>
                            <span className="text-sm text-slate-800 truncate max-w-[18rem]">{u.email}</span>
                          </div>
                        </td>
                        <td className="table-td">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[u.roli] ?? 'bg-slate-100 text-slate-600'}`}>
                            {ROLE_LABELS[u.roli as keyof typeof ROLE_LABELS] ?? u.roli}
                          </span>
                        </td>
                        <td className="table-td">
                          <span className="text-sm text-slate-700 truncate max-w-[14rem] inline-block align-middle">
                            {u.organizationName}
                          </span>
                          {!u.organizationActive && (
                            <span className="ml-2 text-xs text-red-500">pezulluar</span>
                          )}
                        </td>
                        <td className="table-td text-xs text-slate-500">{formatDateTime(new Date(u.createdAt))}</td>
                        <td className="table-td text-right">
                          <Link href={`/platforma/organizatat/${u.organizationId}`}
                            className="text-slate-400 hover:text-blue-600 inline-flex items-center text-xs">
                            Menaxho <RiArrowRightSLine />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {kind !== 'users' && staff.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-700 mb-2">
                Staf me PIN ({staffTotal.toLocaleString('sq-AL')})
              </h2>
              <div className="card overflow-hidden overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="table-th">Emri</th>
                      <th className="table-th">Roli</th>
                      <th className="table-th">Gjendja</th>
                      <th className="table-th">Organizata</th>
                      <th className="table-th">Krijuar</th>
                      <th className="table-th text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((s) => (
                      <tr key={s.id} className="table-row">
                        <td className="table-td">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                              <RiLockLine className="text-emerald-600 text-sm" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm text-slate-800 truncate max-w-[14rem]">{s.emri}</p>
                              {s.kodi && <p className="text-xs text-slate-400 font-mono">{s.kodi}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="table-td text-sm text-slate-600">{s.roli}</td>
                        <td className="table-td">
                          {!s.isActive ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">Joaktiv</span>
                          ) : s.isLocked ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">I bllokuar</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Aktiv</span>
                          )}
                        </td>
                        <td className="table-td">
                          <span className="text-sm text-slate-700 truncate max-w-[14rem] inline-block align-middle">
                            {s.organizationName}
                          </span>
                        </td>
                        <td className="table-td text-xs text-slate-500">{formatDateTime(new Date(s.createdAt))}</td>
                        <td className="table-td text-right">
                          <Link href={`/platforma/organizatat/${s.organizationId}`}
                            className="text-slate-400 hover:text-blue-600 inline-flex items-center text-xs">
                            Menaxho <RiArrowRightSLine />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-4 py-2.5 text-xs text-slate-400 border-t border-slate-100">
                  PIN-et ruhen si hash dhe nuk shfaqen kurrë në këtë panel.
                </p>
              </div>
            </section>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Faqja {page}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-30">E mëparshme</button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={loading || (users.length < 50 && staff.length < 50)}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-30"
              >
                Tjetra
              </button>
            </div>
          </div>
        </div>
      )}
    </PlatformShell>
  )
}

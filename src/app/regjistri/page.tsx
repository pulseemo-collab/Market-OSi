'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import PageHeader from '@/components/ui/PageHeader'
import { formatDateTime } from '@/lib/utils'
import { ROLE_LABELS, Role } from '@/lib/roles'
import {
  RiFileSearchLine,
  RiFilterLine,
  RiCloseLine,
  RiAddCircleLine,
  RiEditLine,
  RiDeleteBin6Line,
  RiUserSettingsLine,
  RiDownloadLine,
  RiInformationLine,
} from 'react-icons/ri'

interface AuditLog {
  id: number
  userId: string
  userEmail: string
  userRole: string
  action: string
  entityType: string
  entityId: string | null
  description: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

interface UserEntry {
  userId: string
  email: string
  roli: string
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Krijim',
  update: 'Modifikim',
  delete: 'Fshirje',
  change_role: 'Ndryshim Roli',
  export: 'Eksport',
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  product: 'Produkt',
  supplier: 'Furnitor',
  supply: 'Furnizim',
  sale: 'Shitje',
  user: 'Përdorues',
  export: 'Eksport',
}

interface FieldChange {
  label: string
  old: unknown
  new: unknown
}

function ChangesDisplay({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return null
  const changes = metadata.changes as FieldChange[] | undefined
  if (!Array.isArray(changes) || changes.length === 0) return null
  return (
    <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-0.5">
      {changes.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-x-1 gap-y-0 text-xs">
          <span className="font-medium text-slate-500 shrink-0">{c.label}:</span>
          <span className="text-red-400 line-through">{String(c.old)}</span>
          <span className="text-slate-300">→</span>
          <span className="font-medium text-emerald-600">{String(c.new)}</span>
        </div>
      ))}
    </div>
  )
}

function ActionIcon({ action }: { action: string }) {
  switch (action) {
    case 'create': return <RiAddCircleLine className="text-emerald-500" />
    case 'update': return <RiEditLine className="text-blue-500" />
    case 'delete': return <RiDeleteBin6Line className="text-red-500" />
    case 'change_role': return <RiUserSettingsLine className="text-violet-500" />
    case 'export': return <RiDownloadLine className="text-slate-500" />
    default: return null
  }
}

const ACTION_BADGE: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  change_role: 'bg-violet-100 text-violet-700',
  export: 'bg-slate-100 text-slate-600',
}

const ENTITY_BADGE: Record<string, string> = {
  product: 'bg-orange-100 text-orange-700',
  supplier: 'bg-teal-100 text-teal-700',
  supply: 'bg-cyan-100 text-cyan-700',
  sale: 'bg-green-100 text-green-700',
  user: 'bg-violet-100 text-violet-700',
  export: 'bg-slate-100 text-slate-600',
}

const ROLE_BADGE: Record<string, string> = {
  Administrator: 'bg-blue-100 text-blue-700',
  Manager:       'bg-violet-100 text-violet-700',
  Cashier:       'bg-emerald-100 text-emerald-700',
}

const emptyFilters = {
  userId: '',
  action: '',
  entityType: '',
  nga: '',
  deri: '',
}

export default function RegjistripageAudit() {
  const { role } = useRole()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [users, setUsers] = useState<UserEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState(emptyFilters)
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters)

  const fetchLogs = useCallback(async (f: typeof emptyFilters) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f.userId) params.set('userId', f.userId)
      if (f.action) params.set('action', f.action)
      if (f.entityType) params.set('entityType', f.entityType)
      if (f.nga) params.set('nga', f.nga)
      if (f.deri) params.set('deri', f.deri)

      const res = await fetch(`/api/audit-logs?${params.toString()}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setLogs(Array.isArray(data.logs) ? data.logs : [])
      setUsers(Array.isArray(data.users) ? data.users : [])
    } catch {
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs(appliedFilters)
  }, [fetchLogs, appliedFilters])

  const handleApply = () => {
    setAppliedFilters({ ...filters })
  }

  const handleClear = () => {
    setFilters(emptyFilters)
    setAppliedFilters(emptyFilters)
  }

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean)

  if (!role || role !== 'Administrator') return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Regjistri i Auditimit"
        subtitle="Gjurmë e plotë e veprimeve të kryera në sistem"
      />

      {/* Filters */}
      <div className="card p-4 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <RiFilterLine className="text-slate-400 text-base" />
          <span className="text-sm font-medium text-slate-700">Filtro regjistrat</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* From date */}
          <div>
            <label className="label">Nga data</label>
            <input
              type="date"
              className="input"
              value={filters.nga}
              onChange={(e) => setFilters((f) => ({ ...f, nga: e.target.value }))}
            />
          </div>

          {/* To date */}
          <div>
            <label className="label">Deri më</label>
            <input
              type="date"
              className="input"
              value={filters.deri}
              onChange={(e) => setFilters((f) => ({ ...f, deri: e.target.value }))}
            />
          </div>

          {/* User filter */}
          <div>
            <label className="label">Përdoruesi</label>
            <select
              className="input"
              value={filters.userId}
              onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
            >
              <option value="">Të gjithë</option>
              {users.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.email}
                </option>
              ))}
            </select>
          </div>

          {/* Action filter */}
          <div>
            <label className="label">Veprimi</label>
            <select
              className="input"
              value={filters.action}
              onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            >
              <option value="">Të gjitha</option>
              {Object.entries(ACTION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          {/* Entity type filter */}
          <div>
            <label className="label">Entiteti</label>
            <select
              className="input"
              value={filters.entityType}
              onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
            >
              <option value="">Të gjitha</option>
              {Object.entries(ENTITY_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2 mt-3">
          <button className="btn-primary" onClick={handleApply}>
            <RiFilterLine className="inline mr-1.5 text-sm" />
            Filtro
          </button>
          {hasActiveFilters && (
            <button className="btn-secondary" onClick={handleClear}>
              <RiCloseLine className="inline mr-1.5 text-sm" />
              Pastro filtrat
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500">
          {loading ? 'Duke ngarkuar...' : (
            <>
              <span className="font-semibold text-slate-700">{logs.length}</span>
              {logs.length === 500 ? '+ regjistrime (maksimumi)' : ' regjistrime'}
              {hasActiveFilters && <span className="ml-1 text-blue-600">(të filtruara)</span>}
            </>
          )}
        </p>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Duke ngarkuar regjistrat...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <RiFileSearchLine className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">Nuk ka regjistrime</p>
            <p className="text-slate-300 text-sm mt-1">
              {hasActiveFilters ? 'Provo të ndryshosh filtrat' : 'Veprimet do të shfaqen këtu sapo të kryhen'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th">Data &amp; Ora</th>
                  <th className="table-th">Përdoruesi</th>
                  <th className="table-th">Roli</th>
                  <th className="table-th">Veprimi</th>
                  <th className="table-th">Entiteti</th>
                  <th className="table-th">Përshkrimi</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, idx) => (
                  <motion.tr
                    key={log.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                    className="table-row"
                  >
                    {/* Date/time */}
                    <td className="table-td whitespace-nowrap">
                      <span className="text-slate-700 text-xs font-medium">
                        {formatDateTime(new Date(log.createdAt))}
                      </span>
                    </td>

                    {/* User */}
                    <td className="table-td">
                      <span className="text-slate-800 text-xs font-medium truncate max-w-[160px] block">
                        {log.userEmail}
                      </span>
                    </td>

                    {/* Role */}
                    <td className="table-td">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_BADGE[log.userRole] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABELS[log.userRole as Role] ?? log.userRole}
                      </span>
                    </td>

                    {/* Action */}
                    <td className="table-td">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${ACTION_BADGE[log.action] ?? 'bg-slate-100 text-slate-600'}`}>
                        <ActionIcon action={log.action} />
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                    </td>

                    {/* Entity */}
                    <td className="table-td">
                      <div className="flex flex-col gap-0.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold w-fit ${ENTITY_BADGE[log.entityType] ?? 'bg-slate-100 text-slate-600'}`}>
                          {ENTITY_TYPE_LABELS[log.entityType] ?? log.entityType}
                        </span>
                        {log.entityId && (
                          <span className="text-slate-400 text-xs font-mono">#{log.entityId}</span>
                        )}
                      </div>
                    </td>

                    {/* Description */}
                    <td className="table-td max-w-xs">
                      <div className="flex items-start gap-1.5">
                        <RiInformationLine className="text-slate-300 text-sm flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-slate-600 text-xs leading-relaxed">
                            {log.description}
                          </span>
                          <ChangesDisplay metadata={log.metadata} />
                        </div>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

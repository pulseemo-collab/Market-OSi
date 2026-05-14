'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import PageHeader from '@/components/ui/PageHeader'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import { ROLE_LABELS, Role } from '@/lib/roles'
import { RiShieldUserLine, RiTeamLine } from 'react-icons/ri'

interface UserEntry {
  id: number
  userId: string
  email: string
  roli: string
  createdAt: string
}

const ROLET: Role[] = ['admin', 'cashier', 'staff']

const roleBadgeClass: Record<Role, string> = {
  admin: 'bg-blue-100 text-blue-700',
  cashier: 'bg-emerald-100 text-emerald-700',
  staff: 'bg-slate-100 text-slate-600',
}

export default function PerdoruesitPage() {
  const { role } = useRole()
  const [users, setUsers] = useState<UserEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setUsers(Array.isArray(data) ? data : [])
    } catch {
      toast.error('Gabim gjatë ngarkimit të përdoruesve')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleRoleChange = async (userId: number, newRole: Role) => {
    setSaving(userId)
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roli: newRole }),
      })
      if (!res.ok) throw new Error()
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, roli: newRole } : u))
      )
      toast.success('Roli u ndryshua me sukses')
    } catch {
      toast.error('Gabim gjatë ndryshimit të rolit')
    } finally {
      setSaving(null)
    }
  }

  if (!role || role !== 'admin') return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Përdoruesit"
        subtitle="Menaxho rolet e përdoruesve të sistemit"
      />

      {/* Role legend */}
      <div className="card p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <RiShieldUserLine className="text-slate-400 text-base" />
          <span className="text-sm font-medium text-slate-700">Rolet e disponueshme</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="font-semibold text-blue-700 mb-1">Admin</p>
            <p className="text-blue-600 text-xs">Akses i plotë — paneli, analitika, fshirje, çmime</p>
          </div>
          <div className="bg-emerald-50 rounded-lg p-3">
            <p className="font-semibold text-emerald-700 mb-1">Kasijer</p>
            <p className="text-emerald-600 text-xs">POS (Shitjet) dhe Historiku bazik</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="font-semibold text-slate-700 mb-1">Staf</p>
            <p className="text-slate-600 text-xs">Produktet, Furnizime dhe Stok i Ulët</p>
          </div>
        </div>
      </div>

      {/* Users table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Duke ngarkuar përdoruesit...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center">
            <RiTeamLine className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400">Nuk ka përdorues akoma</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th">#</th>
                  <th className="table-th">Email</th>
                  <th className="table-th">Roli Aktual</th>
                  <th className="table-th">Ndrysho Rolin</th>
                  <th className="table-th">Regjistruar</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, idx) => (
                  <motion.tr
                    key={user.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.04 }}
                    className="table-row"
                  >
                    <td className="table-td font-mono text-slate-400 text-xs">{idx + 1}</td>
                    <td className="table-td font-medium text-slate-800">{user.email}</td>
                    <td className="table-td">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${roleBadgeClass[user.roli as Role] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABELS[user.roli as Role] ?? user.roli}
                      </span>
                    </td>
                    <td className="table-td">
                      <select
                        value={user.roli}
                        onChange={(e) => handleRoleChange(user.id, e.target.value as Role)}
                        disabled={saving === user.id}
                        className="input py-1 text-sm w-36 disabled:opacity-50"
                      >
                        {ROLET.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="table-td text-slate-400 text-xs">
                      {new Date(user.createdAt).toLocaleDateString('sq-AL')}
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

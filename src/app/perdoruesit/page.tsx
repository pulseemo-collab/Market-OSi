'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import PageHeader from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import { ROLE_LABELS, Role } from '@/lib/roles'
import { formatDateTime } from '@/lib/utils'
import {
  RiShieldUserLine,
  RiTeamLine,
  RiFingerprint2Line,
  RiEditLine,
  RiLockPasswordLine,
  RiUserFollowLine,
  RiUserUnfollowLine,
  RiDeleteBin6Line,
  RiInformationLine,
  RiAlertLine,
} from 'react-icons/ri'

// ─── Email (Supabase) users ───────────────────────────────────────────────────

interface UserEntry {
  id: number
  userId: string
  email: string
  roli: string
  createdAt: string
}

const EMAIL_ROLES: Role[] = ['owner', 'manager', 'cashier', 'employee']

const roleBadgeClass: Record<string, string> = {
  owner:          'bg-blue-100 text-blue-700',
  manager:        'bg-violet-100 text-violet-700',
  cashier:        'bg-emerald-100 text-emerald-700',
  employee:       'bg-slate-100 text-slate-600',
  platform_owner: 'bg-orange-100 text-orange-700',
}

// ─── PIN Staff ────────────────────────────────────────────────────────────────

interface StaffMember {
  id: number
  emri: string
  kodi: string | null
  roli: string
  isActive: boolean
  failedAttempts: number
  lockedUntil: string | null
  createdAt: string
}

const STAFF_ROLE_OPTIONS = [
  { value: 'cashier', label: 'Kasijer' },
  { value: 'employee', label: 'Punonjës' },
]

const STAFF_ROLE_LABELS: Record<string, string> = {
  cashier: 'Kasijer',
  employee: 'Punonjës',
}

const staffRoleBadge: Record<string, string> = {
  cashier: 'bg-emerald-100 text-emerald-700',
  employee: 'bg-slate-100 text-slate-600',
}

function PinInput({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6)
          onChange(v)
        }}
        placeholder="4–6 shifra"
        className="input font-mono tracking-widest text-center text-xl"
      />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PerdoruesitPage() {
  const { role } = useRole()

  // Email users state
  const [users, setUsers] = useState<UserEntry[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)

  // Staff state
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [staffLoading, setStaffLoading] = useState(true)
  const [staffError, setStaffError] = useState(false)

  // Edit staff modal
  const [editStaff, setEditStaff] = useState<StaffMember | null>(null)
  const [editForm, setEditForm] = useState({ emri: '', kodi: '', roli: 'cashier' })
  const [editLoading, setEditLoading] = useState(false)

  // PIN change modal
  const [pinStaff, setPinStaff] = useState<StaffMember | null>(null)
  const [pinForm, setPinForm] = useState({ pin: '', pinConfirm: '' })
  const [pinLoading, setPinLoading] = useState(false)

  // Delete confirm modal
  const [deleteStaff, setDeleteStaff] = useState<StaffMember | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const res = await fetch('/api/users')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setUsers(Array.isArray(data) ? data : [])
    } catch {
      toast.error('Gabim gjatë ngarkimit të përdoruesve')
    } finally {
      setUsersLoading(false)
    }
  }, [])

  const fetchStaff = useCallback(async () => {
    setStaffLoading(true)
    setStaffError(false)
    try {
      const res = await fetch('/api/staff')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setStaff(Array.isArray(data) ? data : [])
    } catch {
      setStaffError(true)
    } finally {
      setStaffLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
    fetchStaff()
  }, [fetchUsers, fetchStaff])

  const handleRoleChange = async (userId: number, newRole: Role) => {
    setSaving(userId)
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roli: newRole }),
      })
      if (!res.ok) throw new Error()
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, roli: newRole } : u)))
      toast.success('Roli u ndryshua me sukses')
    } catch {
      toast.error('Gabim gjatë ndryshimit të rolit')
    } finally {
      setSaving(null)
    }
  }

  async function handleStaffEdit() {
    if (!editStaff) return
    const { emri, kodi, roli } = editForm
    if (!emri.trim()) { toast.error('Emri është i detyrueshëm'); return }

    setEditLoading(true)
    try {
      const res = await fetch(`/api/staff/${editStaff.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emri: emri.trim(), kodi: kodi.trim() || null, roli }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Gabim'); return }
      toast.success('Të dhënat u përditësuan')
      setEditStaff(null)
      fetchStaff()
    } finally {
      setEditLoading(false)
    }
  }

  async function handleStaffPinChange() {
    if (!pinStaff) return
    const { pin, pinConfirm } = pinForm
    if (!/^\d{4,6}$/.test(pin)) { toast.error('PIN duhet të jetë 4–6 shifra'); return }
    if (pin !== pinConfirm) { toast.error('PIN-et nuk përputhen'); return }

    setPinLoading(true)
    try {
      const res = await fetch(`/api/staff/${pinStaff.id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Gabim'); return }
      toast.success('PIN u ndryshua')
      setPinStaff(null)
      setPinForm({ pin: '', pinConfirm: '' })
    } finally {
      setPinLoading(false)
    }
  }

  async function handleToggleActive(s: StaffMember) {
    try {
      const res = await fetch(`/api/staff/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !s.isActive }),
      })
      if (!res.ok) { toast.error('Gabim'); return }
      toast.success(s.isActive ? `"${s.emri}" u çaktivizua` : `"${s.emri}" u aktivizua`)
      fetchStaff()
    } catch {
      toast.error('Gabim')
    }
  }

  async function handleStaffDelete() {
    if (!deleteStaff) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/staff/${deleteStaff.id}`, { method: 'DELETE' })
      if (!res.ok) { toast.error('Gabim gjatë fshirjes'); return }
      toast.success(`"${deleteStaff.emri}" u çaktivizua dhe u fshi`)
      setDeleteStaff(null)
      fetchStaff()
    } finally {
      setDeleteLoading(false)
    }
  }

  if (!role || role !== 'owner') return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Përdoruesit"
        subtitle="Menaxho të gjithë përdoruesit dhe personalin e organizatës"
      />

      {/* ═══════════════════════════════════════════════════════════════
          SECTION A: Supabase / email users
          ═══════════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-2">
          <RiShieldUserLine className="text-blue-500 text-lg" />
          <h2 className="text-base font-semibold text-slate-800">Përdorues me Email</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Hyjnë me email dhe fjalëkalim. Rolet e disponueshme: Pronar, Menaxher, Kasijer, Punonjës.
        </p>

        {/* Role legend */}
        <div className="card p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="font-semibold text-blue-700 mb-1">Pronar</p>
              <p className="text-blue-600 text-xs">Akses i plotë — të gjitha funksionet</p>
            </div>
            <div className="bg-violet-50 rounded-lg p-3">
              <p className="font-semibold text-violet-700 mb-1">Menaxher</p>
              <p className="text-violet-600 text-xs">Produktet, Furnitorët, Furnizime, Raporte, Paneli</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3">
              <p className="font-semibold text-emerald-700 mb-1">Kasijer</p>
              <p className="text-emerald-600 text-xs">POS (Shitjet) dhe Historiku</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="font-semibold text-slate-700 mb-1">Punonjës</p>
              <p className="text-slate-600 text-xs">Akses vetëm-lexim ku është e përshtatshme</p>
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          {usersLoading ? (
            <div className="p-8 text-center">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Duke ngarkuar përdoruesit...</p>
            </div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center">
              <RiTeamLine className="text-4xl text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400">Nuk ka përdorues me email akoma</p>
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
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${roleBadgeClass[user.roli] ?? 'bg-slate-100 text-slate-600'}`}>
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
                          {EMAIL_ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
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
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION B: PIN Staff
          ═══════════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <RiFingerprint2Line className="text-violet-500 text-lg" />
          <h2 className="text-base font-semibold text-slate-800">Personali PIN</h2>
        </div>

        {/* Info note */}
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3">
          <RiInformationLine className="text-amber-500 text-xl flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">
            Personali PIN nuk hyn me email. Ata përdorin emër dhe PIN te{' '}
            <strong>Hyr si Punonjës</strong> (/staff-login). Për të shtuar personal të ri,
            shko te faqja <strong>Personal PIN</strong> në meny.
          </p>
        </div>

        <div className="card overflow-hidden">
          {staffLoading ? (
            <div className="p-8 text-center">
              <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Duke ngarkuar personalin...</p>
            </div>
          ) : staffError ? (
            <div className="p-8 text-center text-slate-400">
              <p className="text-sm">Gabim gjatë ngarkimit të personalit</p>
              <button onClick={fetchStaff} className="btn-secondary mt-3 text-sm">Provo Sërish</button>
            </div>
          ) : staff.length === 0 ? (
            <div className="p-12 text-center">
              <RiFingerprint2Line className="text-4xl text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400">Nuk ka personal me PIN</p>
              <p className="text-xs text-slate-400 mt-1">Shto personal te faqja &ldquo;Personal PIN&rdquo; në meny</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="table-th">#</th>
                    <th className="table-th">Emër dhe Mbiemër</th>
                    <th className="table-th">Roli</th>
                    <th className="table-th text-center">Statusi</th>
                    <th className="table-th">Krijuar më</th>
                    <th className="table-th text-center">Veprime</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s, idx) => {
                    const isLocked = s.lockedUntil && new Date(s.lockedUntil) > new Date()
                    return (
                      <motion.tr
                        key={s.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: idx * 0.03 }}
                        className={`table-row ${!s.isActive ? 'opacity-60' : ''}`}
                      >
                        <td className="table-td font-mono text-slate-400 text-xs">{idx + 1}</td>
                        <td className="table-td">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold ${s.isActive ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                              {s.emri.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-slate-800 text-sm">{s.emri}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {s.kodi && (
                                  <span className="text-xs font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                                    {s.kodi}
                                  </span>
                                )}
                                {isLocked && (
                                  <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
                                    <RiAlertLine className="text-xs" /> Bllokuar
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="table-td">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${staffRoleBadge[s.roli] ?? 'bg-slate-100 text-slate-600'}`}>
                            {STAFF_ROLE_LABELS[s.roli] ?? s.roli}
                          </span>
                        </td>
                        <td className="table-td text-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {s.isActive ? 'Aktiv' : 'Joaktiv'}
                          </span>
                        </td>
                        <td className="table-td text-slate-400 text-xs">
                          {formatDateTime(s.createdAt)}
                        </td>
                        <td className="table-td">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => {
                                setEditStaff(s)
                                setEditForm({ emri: s.emri, kodi: s.kodi ?? '', roli: s.roli })
                              }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                              title="Edito"
                            >
                              <RiEditLine className="text-sm" />
                            </button>
                            <button
                              onClick={() => {
                                setPinStaff(s)
                                setPinForm({ pin: '', pinConfirm: '' })
                              }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                              title="Ndrysho PIN"
                            >
                              <RiLockPasswordLine className="text-sm" />
                            </button>
                            <button
                              onClick={() => handleToggleActive(s)}
                              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                                s.isActive
                                  ? 'text-slate-400 hover:bg-red-50 hover:text-red-500'
                                  : 'text-slate-400 hover:bg-green-50 hover:text-green-600'
                              }`}
                              title={s.isActive ? 'Çaktivizo' : 'Aktivizo'}
                            >
                              {s.isActive
                                ? <RiUserUnfollowLine className="text-sm" />
                                : <RiUserFollowLine className="text-sm" />}
                            </button>
                            <button
                              onClick={() => setDeleteStaff(s)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                              title="Fshi"
                            >
                              <RiDeleteBin6Line className="text-sm" />
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
      </section>

      {/* ── Edit Staff Modal ───────────────────────────────────────────── */}
      <Modal isOpen={!!editStaff} onClose={() => setEditStaff(null)} title="Ndrysho të dhënat" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Emri</label>
            <input
              type="text"
              value={editForm.emri}
              onChange={(e) => setEditForm({ ...editForm, emri: e.target.value })}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Kodi (opsional)</label>
            <input
              type="text"
              value={editForm.kodi}
              onChange={(e) => setEditForm({ ...editForm, kodi: e.target.value })}
              className="input font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Roli</label>
            <select
              value={editForm.roli}
              onChange={(e) => setEditForm({ ...editForm, roli: e.target.value })}
              className="input"
            >
              {STAFF_ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditStaff(null)} className="btn-secondary flex-1" disabled={editLoading}>
              Anulo
            </button>
            <button onClick={handleStaffEdit} className="btn-primary flex-1" disabled={editLoading}>
              {editLoading ? 'Duke ruajtur...' : 'Ruaj'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── PIN Change Modal ───────────────────────────────────────────── */}
      <Modal
        isOpen={!!pinStaff}
        onClose={() => setPinStaff(null)}
        title={`Ndrysho PIN — ${pinStaff?.emri}`}
        size="sm"
      >
        <div className="space-y-4">
          <PinInput
            label="PIN i ri"
            value={pinForm.pin}
            onChange={(v) => setPinForm({ ...pinForm, pin: v })}
          />
          <PinInput
            label="Konfirmo PIN"
            value={pinForm.pinConfirm}
            onChange={(v) => setPinForm({ ...pinForm, pinConfirm: v })}
          />
          <div className="flex gap-3 pt-2">
            <button onClick={() => setPinStaff(null)} className="btn-secondary flex-1" disabled={pinLoading}>
              Anulo
            </button>
            <button onClick={handleStaffPinChange} className="btn-primary flex-1" disabled={pinLoading}>
              {pinLoading ? 'Duke ndryshuar...' : 'Ndrysho PIN'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirm Modal ───────────────────────────────────────── */}
      <Modal
        isOpen={!!deleteStaff}
        onClose={() => !deleteLoading && setDeleteStaff(null)}
        title="Fshi Stafin"
        size="sm"
      >
        {deleteStaff && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <RiDeleteBin6Line className="text-red-600 text-xl" />
              </div>
              <p className="text-slate-700 text-sm leading-relaxed">
                A je i sigurt që dëshiron ta fshish{' '}
                <strong>{deleteStaff.emri}</strong>?
              </p>
            </div>
            <p className="text-xs text-slate-400 mb-5">
              Stafi do të çaktivizohet dhe sesionet aktive do të mbyllen. Të dhënat e shitjeve ruhen.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteStaff(null)}
                disabled={deleteLoading}
                className="btn-secondary flex-1"
              >
                Anulo
              </button>
              <button
                onClick={handleStaffDelete}
                disabled={deleteLoading}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {deleteLoading ? 'Duke fshirë...' : 'Fshi'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

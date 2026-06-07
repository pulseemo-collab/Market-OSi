'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import SubscriptionExpired from '@/components/SubscriptionExpired'
import { useSubscription } from '@/hooks/useSubscription'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import { formatDateTime, toArray } from '@/lib/utils'
import {
  RiAddLine,
  RiEditLine,
  RiLockPasswordLine,
  RiUserFollowLine,
  RiUserUnfollowLine,
  RiComputerLine,
  RiShieldCheckLine,
  RiAlertLine,
} from 'react-icons/ri'

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

const ROLE_OPTIONS = [
  { value: 'cashier', label: 'Kasijer' },
  { value: 'employee', label: 'Punonjës' },
]

const ROLE_LABELS: Record<string, string> = {
  cashier: 'Kasijer',
  employee: 'Punonjës',
}

function PinInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
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

export default function PersonalPage() {
  const { role } = useRole()
  const subscription = useSubscription()

  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ emri: '', kodi: '', roli: 'cashier', pin: '', pinConfirm: '' })
  const [createLoading, setCreateLoading] = useState(false)

  // Edit modal
  const [editStaff, setEditStaff] = useState<StaffMember | null>(null)
  const [editForm, setEditForm] = useState({ emri: '', kodi: '', roli: 'cashier' })
  const [editLoading, setEditLoading] = useState(false)

  // PIN change modal
  const [pinStaff, setPinStaff] = useState<StaffMember | null>(null)
  const [pinForm, setPinForm] = useState({ pin: '', pinConfirm: '' })
  const [pinLoading, setPinLoading] = useState(false)

  // Terminal setup
  const [terminalLoading, setTerminalLoading] = useState(false)

  const fetchStaff = useCallback(async () => {
    try {
      setError(false)
      const res = await fetch('/api/staff')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setStaff(toArray<StaffMember>(data, 'staff'))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStaff() }, [fetchStaff])

  async function handleCreate() {
    const { emri, kodi, roli, pin, pinConfirm } = createForm
    if (!emri.trim()) { toast.error('Emri është i detyrueshëm'); return }
    if (!/^\d{4,6}$/.test(pin)) { toast.error('PIN duhet të jetë 4–6 shifra'); return }
    if (pin !== pinConfirm) { toast.error('PIN-et nuk përputhen'); return }

    setCreateLoading(true)
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emri: emri.trim(), kodi: kodi.trim() || null, roli, pin }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Gabim'); return }
      toast.success(`Stafi "${data.emri}" u shtua`)
      setShowCreate(false)
      setCreateForm({ emri: '', kodi: '', roli: 'cashier', pin: '', pinConfirm: '' })
      fetchStaff()
    } finally {
      setCreateLoading(false)
    }
  }

  async function handleEdit() {
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
    } catch { toast.error('Gabim') }
  }

  async function handlePinChange() {
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

  async function handleSetupTerminal() {
    setTerminalLoading(true)
    try {
      const res = await fetch('/api/staff/terminal', { method: 'POST' })
      if (!res.ok) { toast.error('Gabim'); return }
      toast.success('Terminali u konfigurua')
      window.open('/staff-login', '_blank')
    } finally {
      setTerminalLoading(false)
    }
  }

  if (!role || !['owner', 'manager'].includes(role)) return <AccessDenied />
  if (subscription === 'blocked') return <SubscriptionExpired />

  const activeStaff = staff.filter((s) => s.isActive)
  const inactiveStaff = staff.filter((s) => !s.isActive)

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Personal me PIN"
        subtitle="Menaxho kasierët dhe punonjësit që hyjnë me PIN"
        action={
          <div className="flex gap-2">
            <button
              onClick={handleSetupTerminal}
              disabled={terminalLoading}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              <RiComputerLine />
              Hap Terminal
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary flex items-center gap-2"
            >
              <RiAddLine />
              Shto Staf
            </button>
          </div>
        }
      />

      {/* Info banner */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex gap-3">
        <RiShieldCheckLine className="text-blue-500 text-xl flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700">
          <p className="font-semibold mb-1">Hyrje me PIN — pa email</p>
          <p>Stafi hyn te <strong>/staff-login</strong> me emrin e tyre dhe PIN 4–6 shifra. Sesioni skadon pas 8 orësh.</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-slate-100 rounded-xl" />)}
        </div>
      ) : error ? (
        <div className="text-center py-12 text-slate-400">
          <p>Gabim gjatë ngarkimit</p>
          <button onClick={fetchStaff} className="btn-secondary mt-3 text-sm">Provo Sërish</button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active staff */}
          {activeStaff.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Aktiv ({activeStaff.length})
              </h3>
              <div className="space-y-2">
                {activeStaff.map((s) => (
                  <StaffRow
                    key={s.id}
                    staff={s}
                    onEdit={() => { setEditStaff(s); setEditForm({ emri: s.emri, kodi: s.kodi ?? '', roli: s.roli }) }}
                    onPin={() => { setPinStaff(s); setPinForm({ pin: '', pinConfirm: '' }) }}
                    onToggle={() => handleToggleActive(s)}
                    canEdit={role === 'owner' || role === 'manager'}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Inactive staff */}
          {inactiveStaff.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                Joaktiv ({inactiveStaff.length})
              </h3>
              <div className="space-y-2 opacity-60">
                {inactiveStaff.map((s) => (
                  <StaffRow
                    key={s.id}
                    staff={s}
                    onEdit={() => { setEditStaff(s); setEditForm({ emri: s.emri, kodi: s.kodi ?? '', roli: s.roli }) }}
                    onPin={() => { setPinStaff(s); setPinForm({ pin: '', pinConfirm: '' }) }}
                    onToggle={() => handleToggleActive(s)}
                    canEdit={role === 'owner'}
                  />
                ))}
              </div>
            </div>
          )}

          {staff.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <RiUserFollowLine className="text-5xl mx-auto mb-3 text-slate-200" />
              <p className="font-medium text-slate-500">Nuk ka staf me PIN</p>
              <p className="text-sm mt-1">Shto kasierë ose punonjës me butonin &ldquo;Shto Staf&rdquo;</p>
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Shto Staf me PIN" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Emri <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={createForm.emri}
              onChange={(e) => setCreateForm({ ...createForm, emri: e.target.value })}
              placeholder="p.sh. Andi Krasniqi"
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Kodi (opsional)</label>
            <input
              type="text"
              value={createForm.kodi}
              onChange={(e) => setCreateForm({ ...createForm, kodi: e.target.value })}
              placeholder="p.sh. AK01"
              className="input font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">Kod i shkurtër për identifikim të shpejtë</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Roli <span className="text-red-500">*</span></label>
            <select
              value={createForm.roli}
              onChange={(e) => setCreateForm({ ...createForm, roli: e.target.value })}
              className="input"
            >
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <PinInput label="PIN (4–6 shifra) *" value={createForm.pin} onChange={(v) => setCreateForm({ ...createForm, pin: v })} />
          <PinInput label="Konfirmo PIN *" value={createForm.pinConfirm} onChange={(v) => setCreateForm({ ...createForm, pinConfirm: v })} />
          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1" disabled={createLoading}>Anulo</button>
            <button onClick={handleCreate} className="btn-primary flex-1" disabled={createLoading}>
              {createLoading ? 'Duke shtuar...' : 'Shto'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
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
            <label className="block text-sm font-medium text-slate-700 mb-1">Kodi</label>
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
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditStaff(null)} className="btn-secondary flex-1" disabled={editLoading}>Anulo</button>
            <button onClick={handleEdit} className="btn-primary flex-1" disabled={editLoading}>
              {editLoading ? 'Duke ruajtur...' : 'Ruaj'}
            </button>
          </div>
        </div>
      </Modal>

      {/* PIN change modal */}
      <Modal isOpen={!!pinStaff} onClose={() => setPinStaff(null)} title={`Ndrysho PIN — ${pinStaff?.emri}`} size="sm">
        <div className="space-y-4">
          <PinInput label="PIN i ri" value={pinForm.pin} onChange={(v) => setPinForm({ ...pinForm, pin: v })} />
          <PinInput label="Konfirmo PIN" value={pinForm.pinConfirm} onChange={(v) => setPinForm({ ...pinForm, pinConfirm: v })} />
          <div className="flex gap-3 pt-2">
            <button onClick={() => setPinStaff(null)} className="btn-secondary flex-1" disabled={pinLoading}>Anulo</button>
            <button onClick={handlePinChange} className="btn-primary flex-1" disabled={pinLoading}>
              {pinLoading ? 'Duke ndryshuar...' : 'Ndrysho PIN'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

interface StaffRowProps {
  staff: StaffMember
  onEdit: () => void
  onPin: () => void
  onToggle: () => void
  canEdit: boolean
}

function StaffRow({ staff, onEdit, onPin, onToggle, canEdit }: StaffRowProps) {
  const isLocked = staff.lockedUntil && new Date(staff.lockedUntil) > new Date()

  return (
    <motion.div
      layout
      className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
        staff.isActive ? 'bg-blue-50' : 'bg-slate-100'
      }`}>
        <span className={`text-lg font-bold ${staff.isActive ? 'text-blue-600' : 'text-slate-400'}`}>
          {staff.emri.charAt(0).toUpperCase()}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-slate-900 text-sm">{staff.emri}</p>
          {staff.kodi && (
            <span className="text-xs font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
              {staff.kodi}
            </span>
          )}
          {isLocked && (
            <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
              <RiAlertLine /> Bllokuar
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          {ROLE_LABELS[staff.roli] ?? staff.roli} · Shtuar {formatDateTime(staff.createdAt)}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        {canEdit && (
          <>
            <button
              onClick={onEdit}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              title="Ndrysho"
            >
              <RiEditLine />
            </button>
            <button
              onClick={onPin}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              title="Ndrysho PIN"
            >
              <RiLockPasswordLine />
            </button>
            <button
              onClick={onToggle}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                staff.isActive
                  ? 'text-slate-400 hover:bg-red-50 hover:text-red-500'
                  : 'text-slate-400 hover:bg-green-50 hover:text-green-600'
              }`}
              title={staff.isActive ? 'Çaktivizo' : 'Aktivizo'}
            >
              {staff.isActive ? <RiUserUnfollowLine /> : <RiUserFollowLine />}
            </button>
          </>
        )}
      </div>
    </motion.div>
  )
}

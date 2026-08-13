'use client'

/**
 * Organization Control Center.
 *
 * Everything an operator can learn or do about one tenant, in six tabs. Each tab
 * fetches only its own data on first open, so opening a customer does not pull
 * their whole audit history and every staff record up front.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import toast from 'react-hot-toast'
import PlatformShell from '@/components/platform/PlatformShell'
import { StateBadge, SeverityBadge } from '@/components/platform/StateBadge'
import SubscriptionPanel from '@/components/platform/SubscriptionPanel'
import ErrorState from '@/components/ui/ErrorState'
import Modal from '@/components/ui/Modal'
import { formatDateTime } from '@/lib/utils'
import { formatOrgDate, resolveOrgState } from '@/lib/org-state'
import { deriveOrgAlerts } from '@/lib/platform-alerts'
import { ROLE_LABELS } from '@/lib/roles'
import {
  RiArrowLeftLine, RiBuildingLine, RiTeamLine, RiCoinLine, RiShieldKeyholeLine,
  RiPulseLine, RiFileSearchLine, RiDashboardLine, RiLoader4Line, RiUserAddLine,
  RiUserLine, RiRefreshLine, RiLockLine, RiShoppingCartLine, RiShoppingBasketLine,
  RiTruckLine, RiBellLine, RiAlertLine, RiCheckLine,
} from 'react-icons/ri'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrgDetail {
  id: number
  name: string
  telefoni: string | null
  adresa: string | null
  nipt: string | null
  isActive: boolean
  createdAt: string
  ownerEmail: string | null
  lastActivity: string | null
  subscription: {
    plan: string
    status: string
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    cancelledAt: string | null
  } | null
  counts: {
    users: number; staff: number; products: number; sales: number
    suppliers: number; supplies: number; notifications: number
    unreadNotifications: number; auditLogs: number
  }
  totals: {
    revenue: number; profit: number
    salesLast30Days: number; revenueLast30Days: number
  }
}

interface AccessLogEntry {
  id: number
  action: string
  userEmail: string
  description: string
  metadata: { reason?: string | null } | null
  createdAt: string
}

const TABS = [
  { key: 'overview',     label: 'Përmbledhje',      icon: RiDashboardLine },
  { key: 'users',        label: 'Përdorues & Staf', icon: RiTeamLine },
  { key: 'subscription', label: 'Abonimi',          icon: RiCoinLine },
  { key: 'access',       label: 'Aksesi',           icon: RiShieldKeyholeLine },
  { key: 'activity',     label: 'Aktiviteti',       icon: RiPulseLine },
  { key: 'audit',        label: 'Auditimi',         icon: RiFileSearchLine },
] as const

type TabKey = (typeof TABS)[number]['key']

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrgControlCenterPage() {
  const params = useParams<{ orgId: string }>()
  const orgId = parseInt(params.orgId, 10)

  const [tab, setTab] = useState<TabKey>('overview')
  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [accessLog, setAccessLog] = useState<AccessLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!Number.isFinite(orgId)) {
      setLoadError('ID e pavlefshme organizate')
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/platform/organizations/${orgId}`)
      if (res.status === 401) throw new Error('Sesioni ka skaduar. Hyr sërish.')
      if (res.status === 403) throw new Error('Nuk ke akses te kjo organizatë.')
      if (res.status === 404) throw new Error('Organizata nuk u gjet.')
      if (!res.ok) throw new Error('Organizata nuk u ngarkua dot. Provo sërish.')
      const body = await res.json()
      setOrg(body.organization)
      setAccessLog(body.accessLog ?? [])
    } catch (e) {
      setOrg(null)
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  const alerts = org ? deriveOrgAlerts({ ...org, lastActivity: org.lastActivity }) : []

  return (
    <PlatformShell
      title={org ? org.name : 'Organizata'}
      subtitle={org ? `#${org.id} · krijuar më ${formatOrgDate(org.createdAt)}` : undefined}
      action={
        <div className="flex items-center gap-2">
          <Link href="/platforma/organizatat" className="btn-secondary flex items-center gap-2 whitespace-nowrap">
            <RiArrowLeftLine /> Të gjitha
          </Link>
          <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
            <RiRefreshLine className={loading ? 'animate-spin' : ''} /> Rifresko
          </button>
        </div>
      }
    >
      {loading && !org ? (
        <div className="py-20 text-center">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Duke ngarkuar organizatën...</p>
        </div>
      ) : loadError ? (
        <div className="card"><ErrorState message={loadError} onRetry={load} /></div>
      ) : !org ? null : (
        <>
          {/* Identity strip — always visible, whichever tab is open */}
          <div className="card p-4 mb-5">
            <div className="flex flex-wrap items-center gap-4">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${org.isActive ? 'bg-blue-100' : 'bg-red-100'}`}>
                <RiBuildingLine className={`text-xl ${org.isActive ? 'text-blue-600' : 'text-red-500'}`} />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 truncate">{org.name}</p>
                <p className="text-xs text-slate-400 truncate">
                  {org.ownerEmail ?? 'Pa pronar të regjistruar'}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-3">
                <StateBadge org={org} showDetail />
              </div>
            </div>

            {alerts.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
                {alerts.map((a) => (
                  <div key={a.kind} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50">
                    <SeverityBadge severity={a.severity} />
                    <span className="text-xs text-slate-600">{a.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="mb-5 border-b border-slate-200 overflow-x-auto">
            <div className="flex gap-1 min-w-max">
              {TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                    tab === key
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-200'
                  }`}
                >
                  <Icon className="text-base" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {tab === 'overview' && <OverviewTab org={org} />}
          {tab === 'users' && <UsersTab orgId={orgId} onChanged={load} />}
          {tab === 'subscription' && (
            <SubscriptionPanel
              organizationId={orgId}
              organizationName={org.name}
              isActive={org.isActive}
              onChanged={load}
            />
          )}
          {tab === 'access' && (
            <AccessTab org={org} accessLog={accessLog} onChanged={load} />
          )}
          {tab === 'activity' && <ActivityTab orgId={orgId} />}
          {tab === 'audit' && <AuditTab orgId={orgId} />}
        </>
      )}
    </PlatformShell>
  )
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function Metric({
  label, value, hint, icon: Icon,
}: { label: string; value: string | number; hint?: string; icon: React.ElementType }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500">{label}</span>
        <Icon className="text-slate-300" />
      </div>
      <p className="text-xl font-bold text-slate-800">
        {typeof value === 'number' ? value.toLocaleString('sq-AL') : value}
      </p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="text-xs text-slate-500 w-36 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-800 min-w-0 break-words">{value}</span>
    </div>
  )
}

function OverviewTab({ org }: { org: OrgDetail }) {
  const state = resolveOrgState(org)
  const dash = <span className="text-slate-400 italic">—</span>

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Metric label="Përdorues" value={org.counts.users} hint={`${org.counts.staff} staf me PIN`} icon={RiTeamLine} />
        <Metric label="Produkte" value={org.counts.products} icon={RiShoppingBasketLine} />
        <Metric label="Shitje" value={org.counts.sales} hint={`${org.totals.salesLast30Days} në 30 ditë`} icon={RiShoppingCartLine} />
        <Metric
          label="Xhiro" value={`${org.totals.revenue.toLocaleString('sq-AL', { maximumFractionDigits: 0 })} L`}
          hint={`${org.totals.revenueLast30Days.toLocaleString('sq-AL', { maximumFractionDigits: 0 })} L në 30 ditë`}
          icon={RiCoinLine}
        />
        <Metric label="Furnitorë" value={org.counts.suppliers} hint={`${org.counts.supplies} furnizime`} icon={RiTruckLine} />
        <Metric label="Njoftime" value={org.counts.notifications} hint={`${org.counts.unreadNotifications} pa lexuar`} icon={RiBellLine} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Profili</p>
          <div className="divide-y divide-slate-100">
            <Field label="Emri" value={org.name} />
            <Field label="ID" value={<span className="font-mono text-xs">#{org.id}</span>} />
            <Field label="NIPT" value={org.nipt || dash} />
            <Field label="Telefoni" value={org.telefoni || dash} />
            <Field label="Adresa" value={org.adresa || dash} />
            <Field label="Pronari" value={org.ownerEmail || dash} />
            <Field label="Krijuar më" value={formatDateTime(new Date(org.createdAt))} />
            <Field
              label="Aktiviteti i fundit"
              value={org.lastActivity ? formatDateTime(new Date(org.lastActivity)) : <span className="text-slate-400 italic">Pa shitje</span>}
            />
          </div>
        </div>

        <div className="card p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Gjendja & abonimi</p>
          <div className="divide-y divide-slate-100">
            <Field
              label="Gjendja efektive"
              value={
                <div className="flex flex-col gap-1">
                  <span className={`self-start px-2 py-0.5 rounded-full text-xs font-semibold ${state.color}`}>
                    {state.label}
                  </span>
                  <span className="text-xs text-slate-500">{state.detail}</span>
                </div>
              }
            />
            <Field
              label="Aksesi"
              value={
                state.hasAccess
                  ? <span className="text-green-700 text-sm">Lejohet</span>
                  : <span className="text-red-600 text-sm">I bllokuar</span>
              }
            />
            <Field label="Pezullim administrativ" value={org.isActive ? 'Jo' : 'Po — i pezulluar'} />
            <Field label="Plani" value={org.subscription?.plan ?? dash} />
            <Field label="Status abonimi" value={org.subscription?.status ?? dash} />
            <Field label="Provë deri" value={org.subscription?.trialEndsAt ? formatOrgDate(org.subscription.trialEndsAt) : dash} />
            <Field label="I paguar deri" value={org.subscription?.currentPeriodEnd ? formatOrgDate(org.subscription.currentPeriodEnd) : dash} />
            <Field
              label="Anulim i planifikuar"
              value={org.subscription?.cancelAtPeriodEnd ? `Po — kërkuar më ${formatOrgDate(org.subscription.cancelledAt)}` : 'Jo'}
            />
            <Field label="Fitimi total" value={`${org.totals.profit.toLocaleString('sq-AL', { maximumFractionDigits: 0 })} L`} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Users & Staff tab ────────────────────────────────────────────────────────

interface UserEntry {
  id: number
  userId: string
  email: string
  roli: string
  createdAt: string
}

interface StaffEntry {
  id: number
  emri: string
  kodi: string | null
  roli: string
  isActive: boolean
  isLocked: boolean
  createdAt: string
  salesCount: number
  lastSaleAt: string | null
}

const ROLE_COLORS: Record<string, string> = {
  Administrator: 'bg-blue-100 text-blue-700',
  Manager: 'bg-violet-100 text-violet-700',
  Cashier: 'bg-emerald-100 text-emerald-700',
  platform_owner: 'bg-amber-100 text-amber-700',
}

function UsersTab({ orgId, onChanged }: { orgId: number; onChanged: () => void }) {
  const [users, setUsers] = useState<UserEntry[]>([])
  const [staff, setStaff] = useState<StaffEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRoli, setInviteRoli] = useState('Cashier')
  const [inviting, setInviting] = useState(false)

  const [pendingRole, setPendingRole] = useState<{ user: UserEntry; roli: string } | null>(null)
  const [savingRole, setSavingRole] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [uRes, sRes] = await Promise.all([
        fetch(`/api/platform/organizations/${orgId}/users`),
        fetch(`/api/platform/organizations/${orgId}/staff`),
      ])
      if (!uRes.ok || !sRes.ok) throw new Error('Përdoruesit nuk u ngarkuan dot. Provo sërish.')
      setUsers((await uRes.json()).users ?? [])
      setStaff((await sRes.json()).staff ?? [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  async function invite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      const res = await fetch(`/api/platform/organizations/${orgId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), roli: inviteRoli }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Gabim')
      toast.success(body.message || 'Përdoruesi u shtua')
      setInviteEmail('')
      setInviteRoli('Cashier')
      await load()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gabim gjatë shtimit')
    } finally {
      setInviting(false)
    }
  }

  async function changeRole() {
    if (!pendingRole) return
    setSavingRole(true)
    try {
      const res = await fetch(`/api/platform/organizations/${orgId}/users/${pendingRole.user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roli: pendingRole.roli }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Gabim')
      toast.success('Roli u ndryshua')
      setPendingRole(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gabim gjatë ndryshimit')
    } finally {
      setSavingRole(false)
    }
  }

  if (loading) {
    return (
      <div className="py-16 text-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (loadError) return <div className="card"><ErrorState message={loadError} onRetry={load} /></div>

  return (
    <div className="space-y-5">
      {/* Invite */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <RiUserAddLine className="text-green-600 text-sm" />
          <span className="text-sm font-semibold text-slate-700">Shto përdorues me email</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') invite() }}
            placeholder="email@shembull.com"
            className="input flex-1 text-sm"
            disabled={inviting}
          />
          <select
            value={inviteRoli}
            onChange={(e) => setInviteRoli(e.target.value)}
            className="input text-sm sm:w-44"
            disabled={inviting}
          >
            <option value="Administrator">Administrator</option>
            <option value="Manager">Menaxher</option>
            <option value="Cashier">Kasijer</option>
          </select>
          <button
            onClick={invite}
            disabled={inviting || !inviteEmail.trim()}
            className="btn-primary flex items-center justify-center gap-1.5 text-sm px-4"
          >
            {inviting ? <RiLoader4Line className="animate-spin" /> : <RiUserAddLine />}
            Shto
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Ftesa dërgohet me email nga Supabase. Fjalëkalimet nuk shfaqen dhe nuk ruhen këtu.
        </p>
      </div>

      {/* Email users */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          Llogari me email ({users.length})
        </h3>
        <div className="card overflow-hidden">
          {users.length === 0 ? (
            <div className="p-10 text-center">
              <RiTeamLine className="text-3xl text-slate-200 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">Nuk ka përdorues në këtë organizatë</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {users.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <RiUserLine className="text-blue-600 text-sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{u.email}</p>
                    <p className="text-xs text-slate-400">Shtuar {formatDateTime(new Date(u.createdAt))}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ROLE_COLORS[u.roli] ?? 'bg-slate-100 text-slate-600'}`}>
                    {ROLE_LABELS[u.roli as keyof typeof ROLE_LABELS] ?? u.roli}
                  </span>
                  {u.roli !== 'platform_owner' && (
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) setPendingRole({ user: u, roli: e.target.value }) }}
                      className="input text-xs py-1 w-32"
                      aria-label={`Ndrysho rolin e ${u.email}`}
                    >
                      <option value="">Ndrysho rolin…</option>
                      {['Administrator', 'Manager', 'Cashier']
                        .filter((r) => r !== u.roli)
                        .map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r}</option>
                        ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* PIN staff */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Staf me PIN ({staff.length})</h3>
        <div className="card overflow-hidden">
          {staff.length === 0 ? (
            <div className="p-10 text-center">
              <RiLockLine className="text-3xl text-slate-200 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">Nuk ka staf lokal me PIN</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="table-th">Emri</th>
                    <th className="table-th">Roli</th>
                    <th className="table-th">Gjendja</th>
                    <th className="table-th text-right">Shitje</th>
                    <th className="table-th">Shitja e fundit</th>
                    <th className="table-th">Krijuar</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.id} className="table-row">
                      <td className="table-td">
                        <p className="text-sm text-slate-800">{s.emri}</p>
                        {s.kodi && <p className="text-xs text-slate-400 font-mono">{s.kodi}</p>}
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
                      <td className="table-td text-right text-sm text-slate-700">{s.salesCount}</td>
                      <td className="table-td text-xs text-slate-500">
                        {s.lastSaleAt ? formatDateTime(new Date(s.lastSaleAt)) : <span className="text-slate-300 italic">—</span>}
                      </td>
                      <td className="table-td text-xs text-slate-500">{formatDateTime(new Date(s.createdAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="px-4 py-2.5 text-xs text-slate-400 border-t border-slate-100">
            PIN-et janë të ruajtura si hash dhe nuk shfaqen kurrë. Menaxhimi i stafit bëhet nga vetë marketi.
          </p>
        </div>
      </div>

      {/* Role-change confirmation */}
      <Modal isOpen={pendingRole !== null} onClose={() => setPendingRole(null)} title="Ndrysho rolin" size="sm">
        {pendingRole && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800 mb-2">{pendingRole.user.email}</p>
              <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
                <li>
                  Roli ndryshon nga <strong>{ROLE_LABELS[pendingRole.user.roli as keyof typeof ROLE_LABELS] ?? pendingRole.user.roli}</strong>
                  {' '}në <strong>{ROLE_LABELS[pendingRole.roli as keyof typeof ROLE_LABELS] ?? pendingRole.roli}</strong>.
                </li>
                <li>Lejet e tij ndryshojnë menjëherë në të gjithë aplikacionin.</li>
                <li>Veprimi regjistrohet në auditimin e këtij marketi.</li>
                <li>Organizata nuk mund të mbetet pa asnjë Administrator.</li>
              </ul>
            </div>
            <div className="flex gap-3">
              <button
                onClick={changeRole}
                disabled={savingRole}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {savingRole ? <RiLoader4Line className="animate-spin" /> : <RiCheckLine />}
                Po, ndrysho
              </button>
              <button onClick={() => setPendingRole(null)} className="btn-secondary flex-1">Anulo</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ─── Access tab ───────────────────────────────────────────────────────────────

function AccessTab({
  org, accessLog, onChanged,
}: { org: OrgDetail; accessLog: AccessLogEntry[]; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const state = resolveOrgState(org)
  const nextActive = !org.isActive
  const lastSuspension = accessLog.find((e) => e.action === 'org_suspended')

  async function apply() {
    setSaving(true)
    try {
      const res = await fetch(`/api/platform/organizations/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // The desired state is explicit, so a double submit or a stale view
        // cannot flip the tenant back to where it started.
        body: JSON.stringify({ isActive: nextActive, reason: reason.trim() }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Gabim')
      toast.success(nextActive ? `"${org.name}" u riaktivizua` : `"${org.name}" u pezullua — aksesi u bllokua`)
      setConfirming(false)
      setReason('')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gabim gjatë ndryshimit')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Gjendja e aksesit
        </p>
        <div className="divide-y divide-slate-100">
          <Field
            label="Pezullim administrativ"
            value={
              org.isActive
                ? <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Jo i pezulluar</span>
                : <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">I pezulluar</span>
            }
          />
          <Field
            label="Aksesi efektiv"
            value={
              state.hasAccess
                ? <span className="text-sm text-green-700">Lejohet — {state.detail}</span>
                : <span className="text-sm text-red-600">I bllokuar — {state.detail}</span>
            }
          />
          {!org.isActive && lastSuspension && (
            <>
              <Field label="Pezulluar më" value={formatDateTime(new Date(lastSuspension.createdAt))} />
              <Field label="Nga" value={lastSuspension.userEmail} />
              <Field
                label="Arsyeja"
                value={lastSuspension.metadata?.reason || <span className="text-slate-400 italic">Pa arsye të regjistruar</span>}
              />
            </>
          )}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <RiAlertLine className="text-slate-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-slate-600">
            Pezullimi është <strong>i pavarur nga abonimi</strong>. Ai bllokon aksesin pa e ndryshuar
            planin, statusin apo historikun e faturimit — dhe anasjelltas, heqja e pezullimit nuk
            rikthen një abonim të skaduar.
          </p>
        </div>
      </div>

      {!confirming ? (
        <button
          onClick={() => { setConfirming(true); setReason('') }}
          className={`flex items-center justify-center gap-2 text-sm px-5 py-2.5 rounded-lg text-white font-medium transition-colors ${
            org.isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          <RiShieldKeyholeLine />
          {org.isActive ? 'Pezullo organizatën' : 'Riaktivizo organizatën'}
        </button>
      ) : (
        <div className={`rounded-xl p-4 border ${org.isActive ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
          <p className={`text-sm font-semibold mb-2 ${org.isActive ? 'text-red-800' : 'text-green-800'}`}>
            {org.isActive ? `Pezullo "${org.name}"` : `Riaktivizo "${org.name}"`}
          </p>
          {org.isActive ? (
            <ul className="text-xs text-red-700 space-y-1 list-disc list-inside mb-3">
              <li>Të gjithë përdoruesit e këtij marketi humbasin aksesin menjëherë.</li>
              <li>Kjo <strong>nuk</strong> është anulim abonimi — abonimi mbetet i paprekur.</li>
              <li>Asnjë e dhënë nuk fshihet: produktet, shitjet dhe stafi ruhen.</li>
              <li>Veprimi regjistrohet në auditimin e këtij marketi.</li>
              <li>Mund ta riaktivizoni në çdo moment nga kjo faqe.</li>
            </ul>
          ) : (
            <ul className="text-xs text-green-700 space-y-1 list-disc list-inside mb-3">
              <li>Hiqet pezullimi administrativ.</li>
              <li>Aksesi rikthehet vetëm nëse abonimi e lejon — rregullat e abonimit vazhdojnë të zbatohen.</li>
              <li>Veprimi regjistrohet në auditimin e këtij marketi.</li>
            </ul>
          )}

          <label className="block text-xs font-medium text-slate-600 mb-1">
            Arsyeja (opsionale, ruhet në auditim)
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder={org.isActive ? 'p.sh. mospagesë e konfirmuar' : 'p.sh. pagesa u rregullua'}
            className="input w-full text-sm mb-3"
            disabled={saving}
          />

          <div className="flex gap-2">
            <button
              onClick={apply}
              disabled={saving}
              className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg text-white font-medium transition-colors disabled:opacity-50 ${
                org.isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {saving && <RiLoader4Line className="animate-spin" />}
              {org.isActive ? 'Po, pezullo' : 'Po, riaktivizo'}
            </button>
            <button onClick={() => setConfirming(false)} className="btn-secondary text-sm">Anulo</button>
          </div>
        </div>
      )}

      <div className="card p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Historia e pezullimeve
        </p>
        {accessLog.length === 0 ? (
          <p className="text-sm text-slate-400">Nuk ka pezullime apo riaktivizime të regjistruara.</p>
        ) : (
          <div className="space-y-2">
            {accessLog.map((e) => (
              <div key={e.id} className="text-xs px-3 py-2 rounded-lg bg-slate-50">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className={`px-2 py-0.5 rounded-full font-semibold ${
                    e.action === 'org_suspended' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {e.action === 'org_suspended' ? 'Pezullim' : 'Riaktivizim'}
                  </span>
                  <span className="text-slate-400">{formatDateTime(new Date(e.createdAt))}</span>
                </div>
                <p className="text-slate-600">{e.description}</p>
                <p className="text-slate-400">{e.userEmail}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Activity tab ─────────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string
  stream: 'sale' | 'supply' | 'audit' | 'billing' | 'notification'
  at: string
  title: string
  detail: string | null
  actor: string | null
}

const STREAM_LABELS: Record<ActivityEvent['stream'], string> = {
  sale: 'Shitje',
  supply: 'Furnizim',
  audit: 'Veprim',
  billing: 'Abonim',
  notification: 'Njoftim',
}

const STREAM_COLORS: Record<ActivityEvent['stream'], string> = {
  sale: 'bg-emerald-100 text-emerald-700',
  supply: 'bg-orange-100 text-orange-700',
  audit: 'bg-slate-100 text-slate-600',
  billing: 'bg-amber-100 text-amber-700',
  notification: 'bg-yellow-100 text-yellow-700',
}

function ActivityTab({ orgId }: { orgId: number }) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [stream, setStream] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const qs = stream === 'all' ? '' : `?stream=${stream}`
      const res = await fetch(`/api/platform/organizations/${orgId}/activity${qs}`)
      if (!res.ok) throw new Error('Aktiviteti nuk u ngarkua dot. Provo sërish.')
      setEvents((await res.json()).events ?? [])
    } catch (e) {
      setEvents([])
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [orgId, stream])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {(['all', 'sale', 'supply', 'audit', 'billing', 'notification'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStream(s)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              stream === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s === 'all' ? 'Të gjitha' : STREAM_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="py-14 text-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : events.length === 0 ? (
          <div className="p-12 text-center">
            <RiPulseLine className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">Nuk ka aktivitet të regjistruar</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {events.map((e) => (
              <div key={e.id} className="flex items-start gap-3 p-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${STREAM_COLORS[e.stream]}`}>
                  {STREAM_LABELS[e.stream]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800 break-words">{e.title}</p>
                  {e.detail && <p className="text-xs text-slate-500 break-words">{e.detail}</p>}
                  {e.actor && <p className="text-xs text-slate-400">{e.actor}</p>}
                </div>
                <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                  {formatDateTime(new Date(e.at))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Audit tab ────────────────────────────────────────────────────────────────

interface AuditRow {
  id: number
  userEmail: string
  userRole: string
  action: string
  entityType: string
  description: string
  createdAt: string
}

function AuditTab({ orgId }: { orgId: number }) {
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [actions, setActions] = useState<{ action: string; count: number }[]>([])
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [nga, setNga] = useState('')
  const [deri, setDeri] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({ organizationId: String(orgId), page: String(page), pageSize: '50' })
      if (action) params.set('action', action)
      if (actor) params.set('actor', actor)
      if (nga) params.set('nga', nga)
      if (deri) params.set('deri', deri)

      const res = await fetch(`/api/platform/audit?${params}`)
      if (res.status === 403) throw new Error('Nuk ke akses te auditimi i platformës.')
      if (!res.ok) throw new Error('Auditimi nuk u ngarkua dot. Provo sërish.')
      const body = await res.json()
      setLogs(body.logs ?? [])
      setActions(body.actions ?? [])
      setTotalPages(body.totalPages ?? 1)
      setTotal(body.total ?? 0)
    } catch (e) {
      setLogs([])
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [orgId, page, action, actor, nga, deri])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      {/* A grid rather than flex-wrap: `.input` is w-full, so inside a wrapping
          flex row every control claims its own line. */}
      <div className="card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} className="input text-sm">
            <option value="">Të gjitha veprimet</option>
            {actions.map((a) => <option key={a.action} value={a.action}>{a.action}</option>)}
          </select>
          <input
            value={actor} onChange={(e) => { setActor(e.target.value); setPage(1) }}
            placeholder="Email i përdoruesit" className="input text-sm"
          />
          <input type="date" value={nga} onChange={(e) => { setNga(e.target.value); setPage(1) }} className="input text-sm" aria-label="Nga data" />
          <input type="date" value={deri} onChange={(e) => { setDeri(e.target.value); setPage(1) }} className="input text-sm" aria-label="Deri më" />
        </div>
        {(action || actor || nga || deri) && (
          <button
            onClick={() => { setAction(''); setActor(''); setNga(''); setDeri(''); setPage(1) }}
            className="btn-secondary text-xs mt-2"
          >
            Pastro filtrat
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="py-14 text-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <RiFileSearchLine className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">Asnjë veprim i regjistruar për këto filtra</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {logs.map((l) => (
              <div key={l.id} className="flex items-start gap-3 p-3">
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 flex-shrink-0">
                  {l.action}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800 break-words">{l.description}</p>
                  <p className="text-xs text-slate-400">{l.userEmail} · {l.userRole} · {l.entityType}</p>
                </div>
                <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                  {formatDateTime(new Date(l.createdAt))}
                </span>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">
              {total.toLocaleString('sq-AL')} veprime · faqja {page} nga {totalPages}
            </span>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="btn-secondary text-xs px-2 py-1 disabled:opacity-30">‹</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="btn-secondary text-xs px-2 py-1 disabled:opacity-30">›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

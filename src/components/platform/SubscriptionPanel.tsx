'use client'

/**
 * Subscription control for one organization.
 *
 * Same endpoint and same six actions as before — activate, extend, set next
 * plan, undo a scheduled cancellation, reactivate, cancel — but each one now
 * states what it will do to the customer's access before it is confirmed.
 *
 * No payment provider is involved anywhere in this file. "Aktivizo" records that
 * a payment received out of band has been applied; nothing here charges a card,
 * and the copy is written so an operator cannot mistake it for something that
 * does.
 */

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { getPlanInfo, getStatusInfo } from '@/lib/billing'
import { resolveOrgState, formatOrgDate } from '@/lib/org-state'
import { formatDateTime } from '@/lib/utils'
import ErrorState from '@/components/ui/ErrorState'
import {
  RiCoinLine, RiLoader4Line, RiAddLine, RiCalendarLine, RiRefreshLine, RiHistoryLine,
  RiAlertLine,
} from 'react-icons/ri'

export interface SubscriptionDetail {
  id: number
  organizationId: number
  plan: string
  status: string
  trialEndsAt: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  nextPlan: string | null
  cancelAtPeriodEnd: boolean
  cancelledAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

interface BillingLog {
  id: number
  changedByEmail: string
  oldPlan: string | null
  newPlan: string | null
  oldStatus: string | null
  newStatus: string | null
  notes: string | null
  createdAt: string
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="text-xs text-slate-500 w-36 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-800 min-w-0">{value}</span>
    </div>
  )
}

export default function SubscriptionPanel({
  organizationId,
  organizationName,
  isActive,
  onChanged,
}: {
  organizationId: number
  organizationName: string
  isActive: boolean
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<SubscriptionDetail | null>(null)
  const [logs, setLogs] = useState<BillingLog[]>([])
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [activatePlan, setActivatePlan] = useState<'monthly' | 'yearly'>('monthly')
  const [extendYears, setExtendYears] = useState(0)
  const [extendMonths, setExtendMonths] = useState(1)
  const [nextPlanChoice, setNextPlanChoice] = useState<'monthly' | 'yearly'>('monthly')
  const [reactivatePlan, setReactivatePlan] = useState<'monthly' | 'yearly'>('monthly')
  const [confirmCancel, setConfirmCancel] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/platform/subscriptions/${organizationId}`)
      if (res.status === 403) throw new Error('Nuk ke akses te abonimi i kësaj organizate.')
      if (!res.ok) throw new Error('Abonimi nuk u ngarkua dot. Provo sërish.')
      const body = await res.json()
      setDetail(body.subscription)
      setLogs(body.auditLogs ?? [])
      setOwnerEmail(body.ownerEmail ?? null)
    } catch (e) {
      setDetail(null)
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [organizationId])

  useEffect(() => { load() }, [load])

  async function act(action: string, extra?: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await fetch(`/api/platform/subscriptions/${organizationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Gabim')
      toast.success(body.message || 'Veprimi u krye')
      setConfirmCancel(false)
      await load()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gabim gjatë veprimit')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="py-16 text-center">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Duke ngarkuar abonimin...</p>
      </div>
    )
  }

  if (loadError) return <div className="card"><ErrorState message={loadError} onRetry={load} /></div>

  if (!detail) {
    return (
      <div className="card p-12 text-center">
        <RiCoinLine className="text-4xl text-slate-200 mx-auto mb-3" />
        <p className="text-slate-500 font-medium">Nuk ka abonim për këtë organizatë</p>
        <p className="text-sm text-slate-400 mt-1">
          Aksesi mbetet i bllokuar derisa të regjistrohet një abonim.
        </p>
      </div>
    )
  }

  const state = resolveOrgState({ isActive, subscription: detail })

  return (
    <div className="space-y-4">
      {/* State summary */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Gjendja e abonimit
          </span>
          <button onClick={load} disabled={busy} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <RiRefreshLine /> Rifresko
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          <Row
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
          <Row
            label="Status abonimi"
            value={
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusInfo(detail.status).color}`}>
                {getStatusInfo(detail.status).label}
              </span>
            }
          />
          <Row
            label="Plani"
            value={
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getPlanInfo(detail.plan).color}`}>
                  {getPlanInfo(detail.plan).label}
                </span>
                {detail.nextPlan && (
                  <>
                    <span className="text-xs text-slate-400">→</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getPlanInfo(detail.nextPlan).color}`}>
                      {getPlanInfo(detail.nextPlan).label}
                    </span>
                    <span className="text-xs text-slate-400">(i ardhshëm)</span>
                  </>
                )}
              </div>
            }
          />
          <Row label="Email pronarit" value={ownerEmail ?? <span className="text-slate-400 italic">—</span>} />
          {detail.trialEndsAt && <Row label="Provë deri" value={formatOrgDate(detail.trialEndsAt)} />}
          {detail.currentPeriodStart && <Row label="Perioda fillon" value={formatOrgDate(detail.currentPeriodStart)} />}
          <Row
            label="I paguar deri"
            value={detail.currentPeriodEnd ? formatOrgDate(detail.currentPeriodEnd) : <span className="text-slate-400 italic">—</span>}
          />
          {detail.cancelAtPeriodEnd && (
            <Row
              label="Anulimi"
              value={
                <div className="flex flex-col gap-1">
                  <span className="self-start px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
                    Klienti anuloi rinovimin
                  </span>
                  <span className="text-xs text-slate-500">
                    {detail.cancelledAt && `Kërkuar më ${formatOrgDate(detail.cancelledAt)}. `}
                    Aksesi vazhdon deri më {formatOrgDate(detail.currentPeriodEnd)}.
                  </span>
                </div>
              }
            />
          )}
        </div>

        {!isActive && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
            <RiAlertLine className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">
              Kjo organizatë është <strong>pezulluar nga platforma</strong>. Aksesi mbetet i bllokuar
              pavarësisht gjendjes së abonimit më sipër. Hiqni pezullimin nga skeda “Aksesi”.
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-green-100 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-800 mb-2">Shëno pagesën / Aktivizo</p>
          <div className="flex gap-2">
            <select
              value={activatePlan}
              onChange={(e) => setActivatePlan(e.target.value as 'monthly' | 'yearly')}
              className="input text-sm flex-1" disabled={busy}
            >
              <option value="monthly">Mujor (+1 muaj)</option>
              <option value="yearly">Vjetor (+1 vit)</option>
            </select>
            <button
              onClick={() => act('activate', { plan: activatePlan })}
              disabled={busy}
              className="btn-primary flex items-center gap-1.5 text-sm px-4 whitespace-nowrap"
            >
              {busy ? <RiLoader4Line className="animate-spin" /> : <RiCoinLine />}
              Aktivizo
            </button>
          </div>
          <p className="text-xs text-green-700 mt-2">
            Regjistron një pagesë të marrë jashtë sistemit. Nuk tarifohet asnjë kartë.
            Nëse perioda mbaron në të ardhmen, zgjatet nga aty; përndryshe fillon sot.
          </p>
        </div>

        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-sm font-semibold text-blue-800 mb-2">Zgjat abonimin</p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs text-blue-700 mb-1">Vite</label>
              <input
                type="number" min={0} value={extendYears}
                onChange={(e) => setExtendYears(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="input text-sm w-full" disabled={busy}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-blue-700 mb-1">Muaj</label>
              <input
                type="number" min={0} value={extendMonths}
                onChange={(e) => setExtendMonths(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="input text-sm w-full" disabled={busy}
              />
            </div>
            <button
              onClick={() => act('extend', { years: extendYears, months: extendMonths })}
              disabled={busy || (extendYears === 0 && extendMonths === 0)}
              className="btn-secondary flex items-center gap-1.5 text-sm px-4 whitespace-nowrap"
            >
              {busy ? <RiLoader4Line className="animate-spin" /> : <RiAddLine />}
              Zgjat
            </button>
          </div>
          <p className="text-xs text-blue-700 mt-2">
            Shton kohë mbi periudhën aktuale dhe e kthen abonimin në gjendje aktive.
          </p>
        </div>

        <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
          <p className="text-sm font-semibold text-violet-800 mb-2">Cakto plan të ardhshëm</p>
          <div className="flex gap-2">
            <select
              value={nextPlanChoice}
              onChange={(e) => setNextPlanChoice(e.target.value as 'monthly' | 'yearly')}
              className="input text-sm flex-1" disabled={busy}
            >
              <option value="monthly">Mujor</option>
              <option value="yearly">Vjetor</option>
            </select>
            <button
              onClick={() => act('setNextPlan', { nextPlan: nextPlanChoice })}
              disabled={busy}
              className="btn-secondary flex items-center gap-1.5 text-sm px-4 whitespace-nowrap"
            >
              {busy ? <RiLoader4Line className="animate-spin" /> : <RiCalendarLine />}
              Cakto
            </button>
          </div>
          <p className="text-xs text-violet-700 mt-2">
            Nuk prek periudhën aktuale. Plani i ri hyn në fuqi kur regjistrohet pagesa e ardhshme.
          </p>
        </div>

        {detail.cancelAtPeriodEnd && (
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-sm font-semibold text-orange-800 mb-1">Anulim i planifikuar nga klienti</p>
            <p className="text-xs text-orange-700 mb-3">
              Abonimi mbaron më {formatOrgDate(detail.currentPeriodEnd)}. Klienti ka akses deri atëherë.
              Heqja e anulimit e kthen rinovimin normal.
            </p>
            <button
              onClick={() => act('undoCancel')}
              disabled={busy}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 font-medium transition-colors"
            >
              {busy ? <RiLoader4Line className="animate-spin" /> : <RiRefreshLine />}
              Hiq anulimin
            </button>
          </div>
        )}

        {(detail.status === 'cancelled' || detail.status === 'expired') && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-800 mb-2">Riaktivizo abonimin</p>
            <div className="flex gap-2">
              <select
                value={reactivatePlan}
                onChange={(e) => setReactivatePlan(e.target.value as 'monthly' | 'yearly')}
                className="input text-sm flex-1" disabled={busy}
              >
                <option value="monthly">Mujor (+1 muaj)</option>
                <option value="yearly">Vjetor (+1 vit)</option>
              </select>
              <button
                onClick={() => act('reactivate', { plan: reactivatePlan })}
                disabled={busy}
                className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 whitespace-nowrap font-medium transition-colors"
              >
                {busy ? <RiLoader4Line className="animate-spin" /> : <RiRefreshLine />}
                Riaktivizo
              </button>
            </div>
            <p className="text-xs text-amber-700 mt-2">
              Rikthen aksesin dhe hap një periudhë të re nga sot (ose nga fundi i periudhës ekzistuese).
            </p>
          </div>
        )}
      </div>

      {/* Cancel — kept visually separate from the routine actions above. */}
      {!confirmCancel ? (
        <div className="flex justify-end">
          <button
            onClick={() => setConfirmCancel(true)}
            disabled={busy || detail.status === 'cancelled'}
            className="text-sm text-red-500 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Anulo abonimin menjëherë
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700 mb-2">
            Konfirmo anulimin e abonimit — {organizationName}
          </p>
          <ul className="text-xs text-red-600 mb-3 space-y-1 list-disc list-inside">
            <li>Abonimi anulohet <strong>menjëherë</strong>; aksesi ndërpritet tani, jo në fund të periudhës.</li>
            <li>Kjo ndryshon nga anulimi i klientit, i cili ruan aksesin deri në fund të periudhës së paguar.</li>
            <li>Për të bllokuar aksesin pa prekur abonimin, përdorni skedën <strong>Aksesi</strong> (pezullim).</li>
            <li>Historiku i faturimit dhe të dhënat e marketit ruhen të paprekura.</li>
          </ul>
          <div className="flex gap-2">
            <button
              onClick={() => act('cancel')}
              disabled={busy}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 font-medium transition-colors"
            >
              {busy && <RiLoader4Line className="animate-spin" />}
              Po, anulo tani
            </button>
            <button onClick={() => setConfirmCancel(false)} className="btn-secondary text-sm">
              Mbyll
            </button>
          </div>
        </div>
      )}

      {/* Billing history */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <RiHistoryLine className="text-slate-400 text-sm" />
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Historia e faturimit
          </span>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">Nuk ka ndryshime të regjistruara.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="text-xs px-3 py-2 rounded-lg bg-slate-50 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-700 truncate">{log.changedByEmail}</span>
                  <span className="text-slate-400 whitespace-nowrap">{formatDateTime(new Date(log.createdAt))}</span>
                </div>
                {log.oldPlan !== null && (
                  <div className="text-slate-500">
                    Plan: <span className="font-medium">{log.oldPlan}</span> → <span className="font-medium text-slate-700">{log.newPlan}</span>
                  </div>
                )}
                {log.oldStatus !== null && (
                  <div className="text-slate-500">
                    Status: <span className="font-medium">{log.oldStatus}</span> → <span className="font-medium text-slate-700">{log.newStatus}</span>
                  </div>
                )}
                {log.notes && <div className="text-slate-400 italic">{log.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

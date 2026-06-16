'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRole } from '@/contexts/RoleContext'
import { PLAN_PRICES, getStatusInfo } from '@/lib/billing'
import toast from 'react-hot-toast'
import {
  RiBankCardLine,
  RiCalendarLine,
  RiTimeLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiAlertLine,
  RiBankLine,
  RiArrowLeftLine,
  RiCheckLine,
  RiArrowRightLine,
  RiRefreshLine,
  RiShoppingCartLine,
  RiBarChartLine,
  RiGroupLine,
  RiDatabase2Line,
  RiShieldCheckLine,
  RiHistoryLine,
  RiStarLine,
} from 'react-icons/ri'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubDetails {
  plan: string | null
  nextPlan: string | null
  subStatus: string | null
  trialDaysLeft: number | null
  periodEndsAt: string | null
  allowed: boolean
  cancelAtPeriodEnd: boolean
  closeAtPeriodEnd: boolean
  cancelledAt: string | null
}

interface BillingRecord {
  id: number
  date: string
  description: string
  amount: number | null
  paymentMethod: string
  status: string
}


// ---------------------------------------------------------------------------
// Plan config
// ---------------------------------------------------------------------------
const PLAN_FEATURES = [
  { icon: RiShoppingCartLine, text: 'POS dhe menaxhim shitjesh' },
  { icon: RiDatabase2Line,    text: 'Kontroll stoku' },
  { icon: RiBarChartLine,     text: 'Raporte dhe statistika' },
  { icon: RiGroupLine,        text: 'Menaxhim stafi' },
  { icon: RiShieldCheckLine,  text: 'Backup automatik' },
]

const MONTHLY_DAILY_RATE = PLAN_PRICES.monthly / 30
const YEARLY_DAILY_RATE  = PLAN_PRICES.yearly / 365

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function planLabel(plan: string | null | undefined): string {
  if (plan === 'yearly') return 'Vjetor'
  if (plan === 'monthly') return 'Mujor'
  return plan ?? 'N/A'
}

function dailyRate(plan: string | null | undefined): number {
  if (plan === 'yearly') return YEARLY_DAILY_RATE
  return MONTHLY_DAILY_RATE
}

function computeTopUpAmount(plan: string | null | undefined, days: number): number {
  return Math.round(dailyRate(plan) * days)
}

function addDays(isoDate: string | null | undefined, days: number): Date {
  const base = isoDate ? new Date(isoDate) : new Date()
  const result = new Date(base)
  result.setDate(result.getDate() + days)
  return result
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const info = getStatusInfo(status)
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${info.color}`}>
      {info.label}
    </span>
  )
}

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm ${className}`}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-slate-900 mb-4">{children}</h2>
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AbonimiFaturimiPage() {
  const router = useRouter()
  const { role } = useRole()

  const [details, setDetails]       = useState<SubDetails | null>(null)
  const [loading, setLoading]       = useState(true)
  const [history, setHistory]       = useState<BillingRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  // Top-up state
  const [topUpDays, setTopUpDays]   = useState(30)

  // Auto-renew toggle
  const [togglingRenew, setTogglingRenew] = useState(false)

  // Close store modal
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closing, setClosing]               = useState(false)
  const [undoingClose, setUndoingClose]     = useState(false)

  // Undo cancel (non-close)
  const [undoing, setUndoing] = useState(false)

  // Plan change modal
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [planTarget, setPlanTarget]       = useState<'monthly' | 'yearly' | null>(null)
  const [changingPlan, setChangingPlan]   = useState(false)

  // Top-up payment modal
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [topping, setTopping]                   = useState(false)

  const topUpRef  = useRef<HTMLDivElement>(null)
  const [highlightTopUp, setHighlightTopUp] = useState(false)

  const isOwner  = role === 'Administrator'
  const canView  = role === 'Administrator' || role === 'Manager'

  // ---------------------------------------------------------------------------
  // Fetch data
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(() => {
    fetch('/api/subscription-status')
      .then((r) => r.json())
      .then((d) => {
        setDetails({
          plan: d.plan ?? null,
          nextPlan: d.nextPlan ?? null,
          subStatus: d.subStatus ?? null,
          trialDaysLeft: d.trialDaysLeft ?? null,
          periodEndsAt: d.periodEndsAt ?? null,
          allowed: d.allowed !== false,
          cancelAtPeriodEnd: d.cancelAtPeriodEnd ?? false,
          closeAtPeriodEnd: d.closeAtPeriodEnd ?? false,
          cancelledAt: d.cancelledAt ?? null,
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!canView) { router.replace('/'); return }
    fetchStatus()
    fetch('/api/subscription/billing-history')
      .then((r) => r.json())
      .then((d) => setHistory(d.records ?? []))
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }, [canView, router, fetchStatus])

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const isExpired        = details?.subStatus === 'expired'
    || (!details?.allowed && (details?.subStatus === 'trialing' || details?.subStatus === 'active'))
  const isTrialing       = details?.subStatus === 'trialing' && !!details?.allowed
  const isActive         = details?.subStatus === 'active' && !!details?.allowed
  const isCancelled      = details?.subStatus === 'cancelled'
  const isCloseScheduled   = !!details?.closeAtPeriodEnd && isActive
  const isCancelScheduled  = !!details?.cancelAtPeriodEnd && isActive && !isCloseScheduled
  const isBlocked          = isCancelled || isExpired
  const isAutoRenewOn      = isActive && !details?.cancelAtPeriodEnd

  const currentPlan = details?.plan
  const topUpAmount = computeTopUpAmount(currentPlan, topUpDays)
  const newExpiryDate = addDays(details?.periodEndsAt, topUpDays)

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const scrollToTopUp = () => {
    topUpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightTopUp(true)
    setTimeout(() => setHighlightTopUp(false), 2500)
  }

  const handleToggleRenew = async () => {
    if (togglingRenew) return
    setTogglingRenew(true)
    try {
      if (isAutoRenewOn) {
        const res  = await fetch('/api/subscription/cancel', { method: 'POST' })
        const data = await res.json()
        if (!res.ok) { toast.error(data.error ?? 'Gabim gjatë çaktivizimit'); return }
        if (data.scheduledCancel) {
          toast.success('Rinovimi automatik u çaktivizua.')
          setDetails((prev) => prev ? { ...prev, cancelAtPeriodEnd: true, cancelledAt: new Date().toISOString() } : prev)
        } else {
          setDetails((prev) => prev ? { ...prev, subStatus: 'cancelled', allowed: false, cancelAtPeriodEnd: false } : prev)
        }
      } else {
        const res  = await fetch('/api/subscription/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'undo' }),
        })
        const data = await res.json()
        if (!res.ok) { toast.error(data.error ?? 'Gabim gjatë aktivizimit'); return }
        toast.success('Rinovimi automatik u aktivizua.')
        setDetails((prev) => prev ? { ...prev, cancelAtPeriodEnd: false, closeAtPeriodEnd: false, cancelledAt: null } : prev)
      }
      window.dispatchEvent(new Event('subscription-updated'))
    } catch {
      toast.error('Gabim gjatë ndryshimit')
    } finally {
      setTogglingRenew(false)
    }
  }

  const handleUndoCancel = async () => {
    setUndoing(true)
    try {
      const res  = await fetch('/api/subscription/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undo' }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Gabim gjatë riaktivizimit'); return }
      toast.success('Rinovimi u riaktivizua.')
      setDetails((prev) => prev ? { ...prev, cancelAtPeriodEnd: false, closeAtPeriodEnd: false, cancelledAt: null } : prev)
      window.dispatchEvent(new Event('subscription-updated'))
    } catch {
      toast.error('Gabim gjatë riaktivizimit')
    } finally {
      setUndoing(false)
    }
  }

  const handleConfirmClose = async () => {
    setClosing(true)
    try {
      const res  = await fetch('/api/subscription/close', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Gabim gjatë mbylljes'); return }
      setShowCloseModal(false)
      toast.success('Dyqani do të mbyllet pas skadimit të abonimit.')
      setDetails((prev) => prev ? { ...prev, cancelAtPeriodEnd: true, closeAtPeriodEnd: true, cancelledAt: new Date().toISOString() } : prev)
      window.dispatchEvent(new Event('subscription-updated'))
    } catch {
      toast.error('Gabim gjatë mbylljes')
    } finally {
      setClosing(false)
    }
  }

  const handleUndoClose = async () => {
    setUndoingClose(true)
    try {
      const res  = await fetch('/api/subscription/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undo' }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Gabim gjatë anulimit'); return }
      toast.success('Mbyllja u anulua. Rinovimi vazhdon normalisht.')
      setDetails((prev) => prev ? { ...prev, cancelAtPeriodEnd: false, closeAtPeriodEnd: false, cancelledAt: null } : prev)
      window.dispatchEvent(new Event('subscription-updated'))
    } catch {
      toast.error('Gabim gjatë anulimit')
    } finally {
      setUndoingClose(false)
    }
  }

  const handleConfirmPlanChange = async () => {
    setChangingPlan(true)
    try {
      const res  = await fetch('/api/subscription/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planTarget }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Gabim gjatë ndryshimit të planit'); return }
      toast.success(`Pagesa u simulua. Plani i ardhshëm: ${planLabel(planTarget)}`)
      setShowPlanModal(false)
      setDetails((prev) => prev ? {
        ...prev,
        nextPlan: planTarget,
        subStatus: 'active',
        allowed: true,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        periodEndsAt: data.newPeriodEnd ?? prev.periodEndsAt,
      } : prev)
      fetch('/api/subscription/billing-history')
        .then((r) => r.json())
        .then((d) => setHistory(d.records ?? []))
        .catch(() => {})
      window.dispatchEvent(new Event('subscription-updated'))
    } catch {
      toast.error('Gabim gjatë ndryshimit të planit')
    } finally {
      setChangingPlan(false)
    }
  }

  const handleTopUp = async () => {
    setTopping(true)
    try {
      const res  = await fetch('/api/subscription/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: topUpDays }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Gabim gjatë zgjatjes'); return }
      setShowPaymentModal(false)
      toast.success('Pagesa u simulua me sukses. Abonimi u zgjat.')
      setDetails((prev) => prev ? {
        ...prev,
        subStatus: 'active',
        allowed: true,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        periodEndsAt: data.newPeriodEnd ?? prev.periodEndsAt,
      } : prev)
      fetch('/api/subscription/billing-history')
        .then((r) => r.json())
        .then((d) => setHistory(d.records ?? []))
        .catch(() => {})
      window.dispatchEvent(new Event('subscription-updated'))
    } catch {
      toast.error('Gabim gjatë zgjatjes')
    } finally {
      setTopping(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------
  if (!canView) return null

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-24 mb-5" />
        <div className="flex items-center gap-3 mb-7">
          <div className="w-10 h-10 bg-slate-200 rounded-xl flex-shrink-0" />
          <div className="space-y-2">
            <div className="h-5 bg-slate-200 rounded w-48" />
            <div className="h-3 bg-slate-100 rounded w-64" />
          </div>
        </div>
        <div className="space-y-6">
          {/* Status card */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <div className="h-4 bg-slate-200 rounded w-40 mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="h-3 bg-slate-100 rounded w-20" />
                <div className="h-7 bg-slate-200 rounded-full w-24" />
              </div>
              <div className="h-32 bg-slate-100 rounded-xl" />
            </div>
          </div>
          {/* Plans card */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <div className="h-4 bg-slate-200 rounded w-32 mb-6" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="h-52 bg-slate-100 rounded-xl" />
              <div className="h-52 bg-slate-100 rounded-xl" />
            </div>
          </div>
          {/* Top-up card */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
            <div className="h-4 bg-slate-200 rounded w-36 mb-6" />
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="h-10 bg-slate-100 rounded-lg" />
              <div className="h-10 bg-slate-100 rounded-lg" />
            </div>
            <div className="h-6 bg-slate-100 rounded w-full mb-4" />
            <div className="h-16 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
      {/* Back link */}
      <Link
        href="/cilesime"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
      >
        <RiArrowLeftLine className="text-base" />
        Cilësimet
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
          <RiBankCardLine className="text-violet-600 text-xl" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Abonimi & Faturimi</h1>
          <p className="text-sm text-slate-500">Menaxho abonimin dhe detajet e faturimit</p>
        </div>
      </div>

      {/* Status banners */}
      {isCloseScheduled && (
        <div className="mb-5 bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
          <RiAlertLine className="text-red-500 text-xl flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-800">
              Dyqani do të mbyllet pas skadimit
            </p>
            <p className="text-sm text-red-700 mt-1">
              Aksesi vazhdon deri më {details?.periodEndsAt ? formatDate(details.periodEndsAt) : '—'}.
            </p>
          </div>
          <button
            onClick={handleUndoClose}
            disabled={undoingClose}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors flex-shrink-0 disabled:opacity-60"
          >
            {undoingClose ? 'Duke anuluar...' : 'Anulo mbylljen'}
          </button>
        </div>
      )}

      {isCancelScheduled && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3">
          <RiAlertLine className="text-amber-500 text-xl flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-amber-800">
              Rinovimi automatik është çaktivizuar
            </p>
            <p className="text-sm text-amber-700 mt-1">
              Abonimi do të skadojë më {details?.periodEndsAt ? formatDate(details.periodEndsAt) : '—'} dhe nuk do të rinovohet.
            </p>
          </div>
          <button
            onClick={handleUndoCancel}
            disabled={undoing}
            className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors flex-shrink-0 disabled:opacity-60"
          >
            {undoing ? 'Duke riaktivizuar...' : 'Riaktivizo rinovimin'}
          </button>
        </div>
      )}

      {isCancelled && (
        <div className="mb-5 bg-orange-50 border border-orange-200 rounded-xl p-5 flex items-start gap-3">
          <RiCloseCircleLine className="text-orange-500 text-xl flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-orange-800">Abonimi juaj është anuluar</p>
            <p className="text-sm text-orange-700 mt-1">Për të vazhduar, zgjidhni një plan dhe kryeni pagesën.</p>
          </div>
          <button
            onClick={scrollToTopUp}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            Aktivizo
          </button>
        </div>
      )}

      {isExpired && (
        <div className="mb-5 bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
          <RiAlertLine className="text-red-500 text-xl flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-700">
              {details?.subStatus === 'trialing' ? 'Periudha e provës ka skaduar' : 'Abonimi ka skaduar'}
            </p>
            <p className="text-sm text-red-600 mt-1">Zgjatni abonimin për të rifituar aksesin.</p>
          </div>
          <button
            onClick={scrollToTopUp}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
          >
            Zgjat
          </button>
        </div>
      )}

      <div className="space-y-6">

        {/* ================================================================
            Section 1: Statusi i Abonimit
        ================================================================ */}
        <SectionCard className="p-6">
          <SectionTitle>Statusi i Abonimit</SectionTitle>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Status column */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Statusi</p>
              <div className="flex items-center gap-2">
                {details?.subStatus ? (
                  <StatusBadge status={details.subStatus} />
                ) : (
                  <span className="text-sm text-slate-400">—</span>
                )}
              </div>
            </div>

            {/* Payment method column */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Metoda e Pagesës</p>

              <div className="relative rounded-xl overflow-hidden opacity-70"
                style={{ background: 'linear-gradient(135deg, #475569 0%, #64748b 100%)' }}>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-white/60 text-[10px] font-semibold tracking-widest uppercase">
                      Metodë pagese demo
                    </span>
                    <div className="flex gap-1">
                      <div className="w-7 h-5 rounded-full bg-white/20" />
                      <div className="w-7 h-5 rounded-full bg-white/20 -ml-3" />
                    </div>
                  </div>
                  <p className="text-white/80 text-sm font-medium mb-1">
                    Lidhja me bankën vjen më vonë
                  </p>
                  <p className="text-white/40 font-mono text-xs tracking-widest">
                    •••• •••• •••• ••••
                  </p>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 leading-relaxed">
                Lidhja me bankën do të aktivizohet më vonë.
              </p>
            </div>
          </div>
        </SectionCard>

        {/* ================================================================
            Section 2: Planet Aktive
        ================================================================ */}
        <SectionCard className="p-6">
          <SectionTitle>Planet Aktive</SectionTitle>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Monthly plan card */}
            <PlanCard
              planKey="monthly"
              label="Mujor"
              price="2,990"
              unit="muaj"
              isCurrentPlan={currentPlan === 'monthly' || (isTrialing && !currentPlan)}
              nextPlan={details?.nextPlan}
              isOwner={isOwner}
              onSwitch={() => { setPlanTarget('monthly'); setShowPlanModal(true) }}
            />

            {/* Yearly plan card */}
            <PlanCard
              planKey="yearly"
              label="Vjetor"
              price="29,900"
              unit="vit"
              isCurrentPlan={currentPlan === 'yearly'}
              nextPlan={details?.nextPlan}
              isOwner={isOwner}
              savingsBadge="Kurseni 17%"
              onSwitch={() => { setPlanTarget('yearly'); setShowPlanModal(true) }}
            />
          </div>
        </SectionCard>

        {/* ================================================================
            Section 3: Zgjat Abonimin (Top-Up)
        ================================================================ */}
        <div
          ref={topUpRef}
          className={`transition-all duration-500 ${highlightTopUp ? 'ring-2 ring-blue-400 ring-offset-2 rounded-2xl' : ''}`}
        >
          <SectionCard className="p-6">
            <SectionTitle>Zgjat Abonimin</SectionTitle>

            {/* Days / Amount fields */}
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Ditë</label>
                <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                  <input
                    type="number"
                    min={1}
                    max={1095}
                    value={topUpDays}
                    onChange={(e) => {
                      const v = Math.min(1095, Math.max(1, Number(e.target.value)))
                      setTopUpDays(v)
                    }}
                    className="flex-1 px-3 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none"
                  />
                  <span className="px-3 text-sm text-slate-400 border-l border-slate-200 bg-slate-50">ditë</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Shuma</label>
                <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                  <span className="flex-1 px-3 py-2.5 text-sm font-bold text-blue-700 tabular-nums">
                    {topUpAmount.toLocaleString('sq-AL')}
                  </span>
                  <span className="px-3 text-sm text-slate-400 border-l border-slate-200">ALL</span>
                </div>
              </div>
            </div>

            {/* Quick buttons */}
            <div className="flex flex-wrap gap-2 mb-5">
              {[
                { label: '+7 ditë', days: 7 },
                { label: '+30 ditë', days: 30 },
                { label: '+3 muaj', days: 90 },
                { label: '+1 vit', days: 365 },
              ].map(({ label, days }) => (
                <button
                  key={days}
                  onClick={() => setTopUpDays((prev) => Math.min(1095, prev + days))}
                  className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:text-blue-700"
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Slider */}
            <div className="mb-5">
              <input
                type="range"
                min={1}
                max={1095}
                value={topUpDays}
                onChange={(e) => setTopUpDays(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>1 ditë</span>
                <span>3 vjet</span>
              </div>
            </div>

            {/* Preview */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
              <p className="text-sm font-medium text-blue-900">
                Po zgjat abonimin me <strong>{topUpDays} ditë</strong> për{' '}
                <strong>{topUpAmount.toLocaleString('sq-AL')} ALL</strong>
              </p>
              <p className="text-sm text-blue-700 mt-1 flex items-center gap-1.5">
                <RiCalendarLine className="flex-shrink-0" />
                Data e re e skadimit:{' '}
                <span className="font-semibold">{formatDate(newExpiryDate.toISOString())}</span>
              </p>
              {currentPlan && (
                <p className="text-xs text-blue-500 mt-1">
                  Bazuar në planin {planLabel(currentPlan)} ({currentPlan === 'yearly'
                    ? `${Math.round(YEARLY_DAILY_RATE).toLocaleString('sq-AL')} ALL/ditë`
                    : `${Math.round(MONTHLY_DAILY_RATE).toLocaleString('sq-AL')} ALL/ditë`})
                </p>
              )}
            </div>

            {/* CTA */}
            {isOwner && (
              <button
                onClick={() => setShowPaymentModal(true)}
                className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors text-sm"
              >
                Vazhdo te Pagesa
              </button>
            )}
          </SectionCard>
        </div>

        {/* ================================================================
            Section 4: Historia e Pagesave
        ================================================================ */}
        <SectionCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <RiHistoryLine className="text-slate-400 text-lg" />
            <SectionTitle>Historia e Pagesave</SectionTitle>
          </div>

          {historyLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <RiHistoryLine className="text-3xl mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nuk ka transaksione të regjistruara</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Data</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Përshkrimi</th>
                    <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Shuma</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Metoda</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Statusi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {history.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3 text-slate-500 whitespace-nowrap">{formatDate(rec.date)}</td>
                      <td className="py-3 px-3 text-slate-700">{rec.description}</td>
                      <td className="py-3 px-3 text-right font-semibold text-slate-800 tabular-nums whitespace-nowrap">
                        {rec.amount != null ? `${rec.amount.toLocaleString('sq-AL')} ALL` : '—'}
                      </td>
                      <td className="py-3 px-3 text-slate-500 hidden sm:table-cell whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <RiBankLine className="text-slate-400 text-base" />
                          {rec.paymentMethod}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <RecordStatusBadge status={rec.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* ================================================================
            Section 5: Menaxho Abonimin
        ================================================================ */}
        {isOwner && (
          <SectionCard className="p-6">
            <SectionTitle>Menaxho Abonimin</SectionTitle>

            <div className="space-y-4">
              {/* Expiry date */}
              <div className="flex items-center justify-between py-3 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-600">
                  <RiCalendarLine className="text-slate-400" />
                  <span className="text-sm">Abonimi skadon më</span>
                </div>
                <span className="text-sm font-semibold text-slate-800">
                  {details?.periodEndsAt ? formatDate(details.periodEndsAt) : '—'}
                </span>
              </div>

              {/* Auto-renew toggle */}
              <div className="flex items-center justify-between py-3 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-600">
                  <RiRefreshLine className="text-slate-400" />
                  <span className="text-sm">Rinovim automatik</span>
                </div>
                <button
                  onClick={handleToggleRenew}
                  disabled={togglingRenew || !isActive || isCloseScheduled}
                  role="switch"
                  aria-checked={isAutoRenewOn}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
                    disabled:opacity-40 disabled:cursor-not-allowed
                    ${isAutoRenewOn ? 'bg-green-500' : 'bg-slate-300'}`}
                >
                  {togglingRenew ? (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    </span>
                  ) : (
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      isAutoRenewOn ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  )}
                </button>
              </div>

              {/* Status badge */}
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                isAutoRenewOn
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-amber-50 border border-amber-200 text-amber-700'
              }`}>
                {isAutoRenewOn ? (
                  <RiCheckboxCircleLine className="text-green-500 flex-shrink-0 text-base" />
                ) : (
                  <RiAlertLine className="text-amber-500 flex-shrink-0 text-base" />
                )}
                {isAutoRenewOn ? 'Rinovimi automatik është aktiv' : 'Rinovimi automatik është çaktivizuar'}
              </div>

              {/* Store closure action */}
              {isActive && (
                <div className="pt-2 border-t border-slate-100">
                  {isCloseScheduled ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-medium text-slate-700">Dyqani do të mbyllet pas skadimit</p>
                      <button
                        onClick={handleUndoClose}
                        disabled={undoingClose}
                        className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-amber-700 border border-amber-300 rounded-xl hover:bg-amber-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {undoingClose ? 'Duke anuluar...' : 'Anulo mbylljen'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCloseModal(true)}
                      className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition-colors"
                    >
                      Mbyll Dyqanin
                    </button>
                  )}
                </div>
              )}
            </div>
          </SectionCard>
        )}

      </div>

      {/* ================================================================
          Close Store Modal
      ================================================================ */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center flex-shrink-0">
                <RiAlertLine className="text-red-500 text-xl" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Mbyll dyqanin?</h3>
                <p className="text-xs text-slate-500">Konfirmo veprimin</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Dyqani do të mbyllet pas përfundimit të abonimit aktual edhe të gjitha të dhënat do të fshihen. Aksesi do të vazhdojë deri më{' '}
              <strong>{details?.periodEndsAt ? formatDate(details.periodEndsAt) : '—'}</strong>.
              {' '}Pas kësaj date, dyqani do të bllokohet dhe nuk do të rinovohet më automatikisht. Të dhënat nuk fshihen menjëherë.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowCloseModal(false)}
                disabled={closing}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Mbyll
              </button>
              <button
                onClick={handleConfirmClose}
                disabled={closing}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {closing ? 'Duke mbyllur...' : 'Konfirmo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          Plan Change Modal
      ================================================================ */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center flex-shrink-0">
                <RiRefreshLine className="text-blue-500 text-xl" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">
                  {planTarget === null ? 'Hiq Planin e Ardhshëm?' : `Kalo në ${planLabel(planTarget)}?`}
                </h3>
                <p className="text-xs text-slate-500">Ndryshimi hyn në fuqi pas periudhës aktuale</p>
              </div>
            </div>

            {planTarget !== null ? (
              <div className="space-y-2 text-sm text-slate-600 leading-relaxed">
                <p>
                  Po kalon nga <strong>{planLabel(currentPlan)}</strong> në{' '}
                  <strong>{planLabel(planTarget)}</strong>.
                </p>
                <p>
                  Pagesa do të simulohet menjëherë. Abonimi zgjat me{' '}
                  <strong>{planTarget === 'yearly' ? '365' : '30'} ditë</strong> nga data aktuale e skadimit.
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
                  {planLabel(planTarget)} pas skadimit aktivizohet pas përfundimit të periudhës aktuale.
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600 leading-relaxed">
                Plani i ardhshëm do të hiqet. Do të vazhdoni me planin aktual{' '}
                <strong>{planLabel(currentPlan)}</strong>.
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowPlanModal(false)}
                disabled={changingPlan}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Mbyll
              </button>
              <button
                onClick={handleConfirmPlanChange}
                disabled={changingPlan}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {changingPlan ? 'Duke ndryshuar...' : planTarget === null ? 'Konfirmo' : `Zgjidh ${planLabel(planTarget)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          Top-Up Payment Modal
      ================================================================ */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center flex-shrink-0">
                <RiBankLine className="text-blue-500 text-xl" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Konfirmo Zgjatjen</h3>
                <p className="text-xs text-slate-500">Simulim pagese</p>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Detajet</p>
              </div>
              <div className="divide-y divide-slate-100">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-500">Zgjatje</span>
                  <span className="text-sm font-semibold text-slate-800">{topUpDays} ditë</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-500">Plan</span>
                  <span className="text-sm font-semibold text-slate-800">{planLabel(currentPlan)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-500">Shuma</span>
                  <span className="text-sm font-bold text-blue-700">
                    {topUpAmount.toLocaleString('sq-AL')} ALL
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-500">Data e re e skadimit</span>
                  <span className="text-sm font-medium text-slate-800">{formatDate(newExpiryDate.toISOString())}</span>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-xl">
              <RiCheckboxCircleLine className="text-blue-500 text-base flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 leading-relaxed">
                Pagesa simulohet menjëherë dhe abonimi zgjatet automatikisht.
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowPaymentModal(false)}
                disabled={topping}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Mbyll
              </button>
              <button
                onClick={handleTopUp}
                disabled={topping}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {topping ? 'Duke procesuar...' : 'Konfirmo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PlanCard component
// ---------------------------------------------------------------------------

interface PlanCardProps {
  planKey: 'monthly' | 'yearly'
  label: string
  price: string
  unit: string
  isCurrentPlan: boolean
  nextPlan: string | null | undefined
  isOwner: boolean
  savingsBadge?: string
  onSwitch: () => void
}

function PlanCard({ planKey, label, price, unit, isCurrentPlan, nextPlan, isOwner, savingsBadge, onSwitch }: PlanCardProps) {
  const isNextPlan = nextPlan === planKey

  return (
    <div className={`relative rounded-xl border-2 p-5 flex flex-col gap-4 transition-colors ${
      isCurrentPlan
        ? 'border-blue-500 bg-blue-50/50'
        : 'border-slate-200 bg-white hover:border-slate-300'
    }`}>
      {savingsBadge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500 text-white text-xs font-semibold rounded-full shadow-sm">
            <RiStarLine className="text-xs" />
            {savingsBadge}
          </span>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold text-slate-700 mb-1">{label}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-slate-900">{price}</span>
          <span className="text-sm text-slate-500">ALL / {unit}</span>
        </div>
        {planKey === 'yearly' && (
          <p className="text-xs text-emerald-600 font-medium mt-0.5">
            Ekuivalent me 2,492 ALL / muaj
          </p>
        )}
      </div>

      <ul className="space-y-2 flex-1">
        {PLAN_FEATURES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2 text-sm text-slate-600">
            <RiCheckLine className="text-emerald-500 flex-shrink-0 text-base" />
            {text}
          </li>
        ))}
      </ul>

      {isCurrentPlan ? (
        <div className="flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg">
          <RiCheckLine className="text-base" />
          Plani aktual
        </div>
      ) : isNextPlan ? (
        <div className="flex flex-col items-center gap-1 py-2.5 px-3 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-center gap-1.5 text-blue-700 text-sm font-semibold">
            <RiRefreshLine className="text-base" />
            {label} pas skadimit
          </div>
          <p className="text-xs text-blue-500 text-center">Aktivizohet pas përfundimit të periudhës aktuale.</p>
        </div>
      ) : isOwner ? (
        <button
          onClick={onSwitch}
          className="flex items-center justify-center gap-1.5 py-2.5 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:border-blue-300 hover:text-blue-700 transition-colors"
        >
          <RiArrowRightLine className="text-base" />
          Kalo në {label}
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RecordStatusBadge
// ---------------------------------------------------------------------------

function RecordStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    'Konfirmuar': 'bg-green-100 text-green-700',
    'Anuluar':    'bg-red-100 text-red-700',
    'Në pritje':  'bg-amber-100 text-amber-700',
  }
  const cls = colors[status] ?? 'bg-slate-100 text-slate-500'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

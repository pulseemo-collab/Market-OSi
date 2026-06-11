'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRole } from '@/contexts/RoleContext'
import { PLAN_PRICES, getPlanInfo, getStatusInfo } from '@/lib/billing'
import toast from 'react-hot-toast'
import {
  RiBankCardLine,
  RiCalendarLine,
  RiTimeLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiAlertLine,
  RiBankLine,
  RiInformationLine,
} from 'react-icons/ri'

interface SubDetails {
  plan: string | null
  subStatus: string | null
  trialDaysLeft: number | null
  periodEndsAt: string | null
  trialEndsAt?: string | null
  allowed: boolean
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export default function AbonimiFaturimiPage() {
  const router = useRouter()
  const { role } = useRole()
  const [details, setDetails] = useState<SubDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<'trial' | 'subscription' | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const isOwner = role === 'owner'
  const canView = role === 'owner' || role === 'manager'

  useEffect(() => {
    if (!canView) {
      router.replace('/')
      return
    }
    fetch('/api/subscription-status')
      .then((r) => r.json())
      .then((d) => {
        setDetails({
          plan: d.plan ?? null,
          subStatus: d.subStatus ?? null,
          trialDaysLeft: d.trialDaysLeft ?? null,
          periodEndsAt: d.periodEndsAt ?? null,
          allowed: d.allowed !== false,
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [canView, router])

  const handleCancelClick = (type: 'trial' | 'subscription') => {
    setCancelTarget(type)
    setShowCancelModal(true)
  }

  const handleConfirmCancel = async () => {
    setCancelling(true)
    try {
      const res = await fetch('/api/subscription/cancel', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Gabim gjatë anulimit')
        return
      }
      toast.success('Abonimi u anulua me sukses')
      setShowCancelModal(false)
      setDetails((prev) => prev ? { ...prev, subStatus: 'cancelled', allowed: false } : prev)
    } catch {
      toast.error('Gabim gjatë anulimit')
    } finally {
      setCancelling(false)
    }
  }

  if (!canView) return null

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isExpiredOrCancelled =
    !details?.allowed &&
    (details?.subStatus === 'trialing' || details?.subStatus === 'expired' || details?.subStatus === 'cancelled')

  const isTrialing = details?.subStatus === 'trialing' && details?.allowed
  const isActive = details?.subStatus === 'active' && details?.allowed
  const isCancelled = details?.subStatus === 'cancelled'

  const planLabel = details?.plan
    ? details.plan === 'yearly' ? 'Vjetor' : details.plan === 'monthly' ? 'Mujor' : getPlanInfo(details.plan).label
    : 'N/A'

  const planPrice = details?.plan === 'yearly'
    ? `${PLAN_PRICES.yearly.toLocaleString('sq-AL')} ALL / vit`
    : details?.plan === 'monthly'
    ? `${PLAN_PRICES.monthly.toLocaleString('sq-AL')} ALL / muaj`
    : null

  const statusInfo = details?.subStatus ? getStatusInfo(details.subStatus) : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <RiBankCardLine className="text-blue-600" />
          Abonimi & Faturimi
        </h1>
        <p className="text-sm text-slate-500 mt-1">Menaxho abonimin dhe shiko detajet e faturimit</p>
      </div>

      {/* Trial expired banner */}
      {isExpiredOrCancelled && details?.subStatus === 'trialing' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <RiAlertLine className="text-red-500 text-xl flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700">Trial-i juaj ka përfunduar</p>
            <p className="text-sm text-red-600 mt-1">
              Periudha e provës ka skaduar. Aktivizo abonimin për të vazhduar.
            </p>
          </div>
        </div>
      )}

      {/* Cancelled banner */}
      {isCancelled && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start gap-3">
          <RiCloseCircleLine className="text-slate-500 text-xl flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-slate-700">Abonimi është anuluar</p>
            <p className="text-sm text-slate-500 mt-1">
              Kontaktoni platformën për të riaktivizuar aksesin tuaj.
            </p>
          </div>
        </div>
      )}

      {/* Subscription Status Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-800">Gjendja e Abonimit</h2>

        <div className="grid grid-cols-2 gap-4">
          {/* Plan */}
          <div className="space-y-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Plani</span>
            <p className="text-sm font-semibold text-slate-900">{planLabel}</p>
          </div>

          {/* Status */}
          <div className="space-y-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Statusi</span>
            {statusInfo ? (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            ) : (
              <p className="text-sm text-slate-500">—</p>
            )}
          </div>

          {/* Trial / Period info */}
          {isTrialing && (
            <>
              <div className="space-y-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide flex items-center gap-1">
                  <RiTimeLine className="text-sm" /> Ditë të Mbetura
                </span>
                <p className={`text-sm font-semibold ${(details?.trialDaysLeft ?? 0) <= 3 ? 'text-red-600' : 'text-amber-600'}`}>
                  {details?.trialDaysLeft ?? 0} ditë
                </p>
              </div>
              {details?.periodEndsAt && (
                <div className="space-y-1">
                  <span className="text-xs text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <RiCalendarLine className="text-sm" /> Skadon më
                  </span>
                  <p className="text-sm font-medium text-slate-700">{formatDate(details.periodEndsAt)}</p>
                </div>
              )}
            </>
          )}

          {isActive && details?.periodEndsAt && (
            <div className="space-y-1 col-span-2">
              <span className="text-xs text-slate-500 uppercase tracking-wide flex items-center gap-1">
                <RiCalendarLine className="text-sm" /> Aktiv deri më
              </span>
              <p className="text-sm font-medium text-green-700 flex items-center gap-1">
                <RiCheckboxCircleLine className="text-base" />
                {formatDate(details.periodEndsAt)}
              </p>
            </div>
          )}
        </div>

        {/* Actions - only owner can cancel */}
        {isOwner && (
          <div className="pt-4 border-t border-slate-100 flex flex-wrap gap-2">
            {isTrialing && (
              <button
                onClick={() => handleCancelClick('trial')}
                className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                Anulo Trial
              </button>
            )}
            {isActive && (
              <button
                onClick={() => handleCancelClick('subscription')}
                className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                Anulo Abonim
              </button>
            )}
          </div>
        )}
      </div>

      {/* Billing Details Card */}
      {(planPrice || isTrialing || isActive || isExpiredOrCancelled) && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <RiBankLine className="text-blue-500" />
            Detajet e Faturimit
          </h2>

          {/* Plan + Price */}
          <div className="bg-slate-50 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Plani: {planLabel}</p>
              {planPrice && (
                <p className="text-lg font-bold text-slate-900 mt-1">{planPrice}</p>
              )}
            </div>
            {isActive && (
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                Aktiv
              </span>
            )}
            {isTrialing && (
              <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
                Trial
              </span>
            )}
          </div>

          {/* Payment instructions */}
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
              <RiInformationLine className="text-blue-500 text-base flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 leading-relaxed">
                Për të aktivizuar ose rinovuar abonimin, kryeni pagesën me transfertë bankare dhe
                kontaktoni administratorin e platformës me konfirmimin e pagesës.
              </p>
            </div>

            {/* Bank transfer placeholder */}
            <div className="border border-slate-200 rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Transfertë Bankare</p>
              <div className="space-y-1.5 text-sm text-slate-700">
                <div className="flex justify-between">
                  <span className="text-slate-500">Banka:</span>
                  <span className="font-medium">— të komunikohet —</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">IBAN:</span>
                  <span className="font-medium">— të komunikohet —</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Përfituesi:</span>
                  <span className="font-medium">Market OS</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Shuma:</span>
                  <span className="font-medium">{planPrice ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Arsyeja:</span>
                  <span className="font-medium">Abonim {planLabel}</span>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400 text-center">
              Pas pagesës, administratori do të aktivizojë abonimin brenda 24 orësh.
            </p>
          </div>
        </div>
      )}

      {/* Cancellation Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center flex-shrink-0">
                <RiAlertLine className="text-red-500 text-xl" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">
                  {cancelTarget === 'trial' ? 'Anulo Trial?' : 'Anulo Abonimin?'}
                </h3>
                <p className="text-xs text-slate-500">Kjo veprim nuk mund të kthehet prapa</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              {cancelTarget === 'trial'
                ? 'Nëse anuloni trial-in, do të humbni aksesin menjëherë. Për të ristartuar, kontaktoni platformën.'
                : 'Nëse anuloni abonimin, do të humbni aksesin pas skadimit të periudhës aktuale. Për të rinovuar, kontaktoni platformën.'}
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={cancelling}
                className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Mbyll
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={cancelling}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {cancelling ? 'Duke anuluar...' : 'Konfirmo Anulimin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

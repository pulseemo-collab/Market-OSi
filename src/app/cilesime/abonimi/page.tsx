'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
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
  RiArrowLeftLine,
  RiPhoneLine,
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

export default function CilesimiAbonimiFaturimiPage() {
  const router = useRouter()
  const { role } = useRole()
  const [details, setDetails] = useState<SubDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<'trial' | 'subscription' | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const paymentRef = useRef<HTMLDivElement>(null)
  const [highlightPayment, setHighlightPayment] = useState(false)

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

  const handleActivateClick = () => {
    paymentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightPayment(true)
    setTimeout(() => setHighlightPayment(false), 2500)
  }

  if (!canView) return null

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isExpired = details?.subStatus === 'expired' || (!details?.allowed && details?.subStatus === 'trialing')
  const isTrialing = details?.subStatus === 'trialing' && details?.allowed
  const isActive = details?.subStatus === 'active' && details?.allowed
  const isCancelled = details?.subStatus === 'cancelled'
  const isBlockedState = isCancelled || isExpired

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
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      {/* Back link */}
      <Link
        href="/cilesime"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
      >
        <RiArrowLeftLine className="text-base" />
        Cilësimet
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
          <RiBankCardLine className="text-violet-600 text-xl" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Abonimi & Faturimi</h1>
          <p className="text-sm text-slate-500">Menaxho abonimin dhe shiko detajet e faturimit</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Cancelled banner */}
        {isCancelled && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <RiCloseCircleLine className="text-orange-500 text-xl flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-orange-800">Triali juaj është anuluar</p>
                <p className="text-sm text-orange-700 mt-1">
                  Për të vazhduar përdorimin e Market OS, aktivizoni abonimin tuaj.
                </p>
              </div>
            </div>
            <button
              onClick={handleActivateClick}
              className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Aktivizo Abonimin
            </button>
          </div>
        )}

        {/* Expired banner */}
        {isExpired && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <div className="flex items-start gap-3 mb-4">
              <RiAlertLine className="text-red-500 text-xl flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-700">Trial-i juaj ka përfunduar</p>
                <p className="text-sm text-red-600 mt-1">
                  Periudha e provës ka skaduar. Aktivizoni abonimin tuaj për të vazhduar.
                </p>
              </div>
            </div>
            <button
              onClick={handleActivateClick}
              className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Aktivizo Abonimin
            </button>
          </div>
        )}

        {/* Subscription Status Card */}
        <div className="card p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">Gjendja e Abonimit</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <span className="text-xs text-slate-500 uppercase tracking-wide">Plani</span>
              <p className="text-sm font-semibold text-slate-900">{planLabel}</p>
            </div>

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
        {(isBlockedState || isTrialing || isActive) && (
          <div
            ref={paymentRef}
            className={`card p-6 space-y-5 transition-all duration-500 ${
              highlightPayment ? 'ring-2 ring-blue-400 ring-offset-2' : ''
            }`}
          >
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <RiBankLine className="text-blue-500" />
              Detajet e Faturimit
            </h2>

            {(isTrialing || isActive) && (
              <div className="bg-slate-50 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-700">Plani: {planLabel}</p>
                  {planPrice && (
                    <p className="text-lg font-bold text-slate-900 mt-1">{planPrice}</p>
                  )}
                </div>
                {isActive && (
                  <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">Aktiv</span>
                )}
                {isTrialing && (
                  <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">Trial</span>
                )}
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
                <RiInformationLine className="text-blue-500 text-base flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  Kryeni pagesën me transfertë bankare dhe kontaktoni administratorin e platformës
                  me konfirmimin e pagesës për aktivizim brenda 24 orësh.
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Transfertë Bankare</p>
                </div>
                <div className="divide-y divide-slate-100">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-slate-500">Plani i zgjedhur</span>
                    <span className="text-sm font-semibold text-slate-800">{planLabel}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-slate-500">Shuma për pagesë</span>
                    <span className="text-sm font-bold text-blue-700">
                      {planPrice ?? '— zgjidhni planin —'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-slate-500">Përfituesi</span>
                    <span className="text-sm font-medium text-slate-800">Market OS</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-slate-500">IBAN</span>
                    <span className="text-sm text-slate-400 italic">— të komunikohet —</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-slate-500">Arsyeja e pagesës</span>
                    <span className="text-sm font-medium text-slate-800">Abonim {planLabel}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <RiPhoneLine className="text-slate-400 text-base flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-slate-600">Kontakt & Mbështetje</p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Pas kryerjes së pagesës, dërgoni konfirmimin te administratori i platformës
                    për aktivizimin e abonimit tuaj.
                  </p>
                  <p className="text-xs text-slate-400 italic mt-1">
                    — detajet e kontaktit komunikohen nga platforma —
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-400 text-center">
                Abonimi aktivizohet brenda 24 orësh nga konfirmimi i pagesës.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Cancellation Modal */}
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

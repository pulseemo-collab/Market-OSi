'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  RiShieldCheckLine,
  RiCalendarLine,
  RiArrowRightLine,
  RiBankLine,
  RiInformationLine,
} from 'react-icons/ri'

interface SubInfo {
  loading: boolean
  plan: string | null
  trialDaysLeft: number | null
  trialEndsAt: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export default function TrialWelcomePage() {
  const router = useRouter()
  const [sub, setSub] = useState<SubInfo>({ loading: true, plan: null, trialDaysLeft: null, trialEndsAt: null })

  useEffect(() => {
    fetch('/api/subscription-status')
      .then((r) => r.json())
      .then((d) =>
        setSub({
          loading: false,
          plan: d.plan ?? null,
          trialDaysLeft: d.trialDaysLeft ?? null,
          trialEndsAt: d.periodEndsAt ?? null,
        })
      )
      .catch(() => setSub({ loading: false, plan: null, trialDaysLeft: null, trialEndsAt: null }))
  }, [])

  const planLabel = sub.plan === 'yearly' ? 'Vjetor' : sub.plan === 'monthly' ? 'Mujor' : sub.plan ?? '—'

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md space-y-4"
      >
        {/* Header card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-100 rounded-2xl mb-4">
            <RiShieldCheckLine className="text-emerald-600 text-3xl" />
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-1">Mirë se vini në Market OS!</h1>
          <p className="text-slate-500 text-sm">Llogaria juaj u krijua me sukses.</p>
        </div>

        {/* Trial status card */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <RiCalendarLine className="text-amber-600 text-lg flex-shrink-0" />
            <span className="font-semibold text-amber-800">Trial 14 ditë aktiv</span>
          </div>
          {!sub.loading && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-amber-700">Plani i zgjedhur:</span>
                <span className="font-semibold text-amber-900">{planLabel}</span>
              </div>
              {sub.trialDaysLeft !== null && (
                <div className="flex justify-between">
                  <span className="text-amber-700">Ditë të mbetura:</span>
                  <span className="font-semibold text-amber-900">{sub.trialDaysLeft} ditë</span>
                </div>
              )}
              {sub.trialEndsAt && (
                <div className="flex justify-between">
                  <span className="text-amber-700">Trial përfundon më:</span>
                  <span className="font-semibold text-amber-900">{formatDate(sub.trialEndsAt)}</span>
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-amber-600 mt-1">
            Pagesa do kërkohet pas përfundimit të trial-it — nuk nevojitet kartë krediti tani.
          </p>
        </div>

        {/* Payment instructions card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <RiBankLine className="text-slate-500 text-lg flex-shrink-0" />
            <span className="font-semibold text-slate-700">Instruksione pagese</span>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 space-y-1.5 text-sm text-slate-600">
            <div className="flex items-start gap-1.5">
              <RiInformationLine className="text-slate-400 text-base flex-shrink-0 mt-0.5" />
              <span>Pagesa bëhet me transfertë bankare pas skadimit të trial-it.</span>
            </div>
            <p className="text-xs text-slate-400 pt-1">
              Detajet e llogarisë bankare do të dërgohen me email para skadimit të trial-it.
            </p>
          </div>
        </div>

        {/* CTA */}
        <Link
          href="/"
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl transition-colors"
        >
          Vazhdo në dyqanin tim
          <RiArrowRightLine />
        </Link>

        <p className="text-center text-xs text-slate-400">
          Mund ta hapësh këtë faqe gjithmonë nga cilësimet e llogarisë
        </p>
      </motion.div>
    </div>
  )
}

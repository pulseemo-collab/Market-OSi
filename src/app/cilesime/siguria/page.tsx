'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import { useSubscription } from '@/hooks/useSubscription'
import SubscriptionExpired from '@/components/SubscriptionExpired'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'
import {
  RiShieldKeyholeLine,
  RiArrowLeftLine,
  RiLockPasswordLine,
  RiEyeLine,
  RiEyeOffLine,
  RiShieldCheckLine,
  RiInformationLine,
} from 'react-icons/ri'

export default function SiguriaPage() {
  const { role } = useRole()
  const subscription = useSubscription()
  const canView = role === 'Administrator' || role === 'Manager'

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!canView) return <AccessDenied />
  if (subscription === 'blocked') return <SubscriptionExpired />

  const handleChangePassword = async () => {
    if (!newPassword) {
      toast.error('Shkruani fjalëkalimin e ri')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Fjalëkalimi duhet të ketë të paktën 8 karaktere')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Fjalëkalimet nuk përputhen')
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        toast.error(error.message ?? 'Gabim gjatë ndryshimit të fjalëkalimit')
        return
      }
      toast.success('Fjalëkalimi u ndryshua me sukses')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      toast.error('Gabim gjatë ndryshimit të fjalëkalimit')
    } finally {
      setSaving(false)
    }
  }

  const passwordStrength = (() => {
    if (!newPassword) return null
    if (newPassword.length < 8) return { label: 'Shumë i shkurtër', color: 'text-red-500', bar: 'bg-red-400', w: 'w-1/4' }
    if (newPassword.length < 12) return { label: 'Mesatar', color: 'text-amber-600', bar: 'bg-amber-400', w: 'w-2/4' }
    if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) return { label: 'Mesatar', color: 'text-amber-600', bar: 'bg-amber-400', w: 'w-2/4' }
    return { label: 'I fortë', color: 'text-emerald-600', bar: 'bg-emerald-500', w: 'w-full' }
  })()

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
        <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
          <RiShieldKeyholeLine className="text-amber-600 text-xl" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Siguria</h1>
          <p className="text-sm text-slate-500">Menaxhoni fjalëkalimin dhe sigurinë e llogarisë</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Change Password */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <RiLockPasswordLine className="text-slate-500 text-lg" />
            <h2 className="text-base font-semibold text-slate-800">Ndrysho Fjalëkalimin</h2>
          </div>

          {/* New password */}
          <div>
            <label className="label">Fjalëkalimi i Ri</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input pr-10"
                placeholder="Minimum 8 karaktere"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showNew ? <RiEyeOffLine /> : <RiEyeLine />}
              </button>
            </div>
            {passwordStrength && (
              <div className="mt-2">
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${passwordStrength.bar} ${passwordStrength.w}`} />
                </div>
                <span className={`text-xs mt-1 block ${passwordStrength.color}`}>{passwordStrength.label}</span>
              </div>
            )}
          </div>

          {/* Confirm password */}
          <div>
            <label className="label">Konfirmo Fjalëkalimin</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input pr-10"
                placeholder="Konfirmoni fjalëkalimin e ri"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showConfirm ? <RiEyeOffLine /> : <RiEyeLine />}
              </button>
            </div>
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-red-500 mt-1">Fjalëkalimet nuk përputhen</p>
            )}
          </div>

          <button
            onClick={handleChangePassword}
            disabled={saving}
            className="btn-primary flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <RiShieldCheckLine className="text-base" />
            )}
            {saving ? 'Duke ndryshuar...' : 'Ndrysho Fjalëkalimin'}
          </button>
        </div>

        {/* Security Info */}
        <div className="card p-6 space-y-3">
          <div className="flex items-center gap-2">
            <RiInformationLine className="text-slate-500 text-lg" />
            <h2 className="text-base font-semibold text-slate-800">Informacion Sigurie</h2>
          </div>

          <div className="space-y-2 text-sm text-slate-600">
            <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg">
              <RiShieldCheckLine className="text-emerald-500 flex-shrink-0 mt-0.5" />
              <span>Sesionet tuaja menaxhohen automatikisht nga sistemi. Dilni nga llogaria nëse jeni në një pajisje publike.</span>
            </div>
            <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg">
              <RiShieldCheckLine className="text-emerald-500 flex-shrink-0 mt-0.5" />
              <span>Fjalëkalimi ruhet i kodifikuar dhe nuk mund të lexohet nga askush.</span>
            </div>
            <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg">
              <RiShieldCheckLine className="text-emerald-500 flex-shrink-0 mt-0.5" />
              <span>Rekomandohet të ndryshoni fjalëkalimin çdo 3–6 muaj.</span>
            </div>
          </div>
        </div>

        {/* 2FA Placeholder */}
        <div className="card p-6 opacity-60">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-800">Vërtetimi me Dy Faktorë (2FA)</h2>
              <p className="text-sm text-slate-500 mt-0.5">Shtoni një shtresë shtesë sigurie në llogarinë tuaj</p>
            </div>
            <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-medium rounded-full">
              Së shpejti
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

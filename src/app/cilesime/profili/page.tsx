'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRole } from '@/contexts/RoleContext'
import { useSubscription } from '@/hooks/useSubscription'
import SubscriptionExpired from '@/components/SubscriptionExpired'
import AccessDenied from '@/components/AccessDenied'
import toast from 'react-hot-toast'
import {
  RiStore2Line,
  RiArrowLeftLine,
  RiPhoneLine,
  RiMapPinLine,
  RiFileListLine,
  RiImageLine,
  RiSaveLine,
} from 'react-icons/ri'

interface OrgProfile {
  id: number
  name: string
  telefoni: string | null
  adresa: string | null
  nipt: string | null
}

export default function ProfiliBiznesitPage() {
  const { role } = useRole()
  const subscription = useSubscription()
  const isOwner = role === 'Administrator'
  const canView = role === 'Administrator' || role === 'Manager'

  const [profile, setProfile] = useState<OrgProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [telefoni, setTelefoni] = useState('')
  const [adresa, setAdresa] = useState('')
  const [nipt, setNipt] = useState('')

  useEffect(() => {
    if (!canView) return
    fetch('/api/organizations/profile')
      .then((r) => r.json())
      .then((d: OrgProfile) => {
        setProfile(d)
        setName(d.name ?? '')
        setTelefoni(d.telefoni ?? '')
        setAdresa(d.adresa ?? '')
        setNipt(d.nipt ?? '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [canView])

  if (!canView) return <AccessDenied />
  if (subscription === 'blocked') return <SubscriptionExpired />

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Emri i biznesit është i detyrueshëm')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/organizations/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), telefoni, adresa, nipt }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Gabim gjatë ruajtjes')
        return
      }
      setProfile(data)
      toast.success('Profili u ruajt me sukses')
    } catch {
      toast.error('Gabim gjatë ruajtjes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      {/* Back link */}
      <Link
        href="/cilesime"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
      >
        <RiArrowLeftLine className="text-base" />
        Cilësimet
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
          <RiStore2Line className="text-blue-600 text-xl" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Profili i Biznesit</h1>
          <p className="text-sm text-slate-500">Informacioni zyrtar i dyqanit tuaj</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-5 animate-pulse">
          <div className="card p-6 space-y-4">
            <div className="h-3 bg-slate-200 rounded w-48 mb-2" />
            {[1, 2, 3, 4].map((i) => (
              <div key={i}>
                <div className="h-3 bg-slate-100 rounded w-28 mb-1.5" />
                <div className="h-10 bg-slate-100 rounded-lg" />
              </div>
            ))}
          </div>
          <div className="card p-6">
            <div className="h-3 bg-slate-200 rounded w-36 mb-4" />
            <div className="h-32 bg-slate-100 rounded-xl" />
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Business info card */}
          <div className="card p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
              Informacioni i Biznesit
            </h2>

            {/* Store name */}
            <div>
              <label className="label flex items-center gap-1.5">
                <RiStore2Line className="text-slate-400" />
                Emri i Dyqanit <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isOwner}
                className="input"
                placeholder="p.sh. Marketi Miri"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="label flex items-center gap-1.5">
                <RiPhoneLine className="text-slate-400" />
                Numri i Telefonit
              </label>
              <input
                type="tel"
                value={telefoni}
                onChange={(e) => setTelefoni(e.target.value)}
                disabled={!isOwner}
                className="input"
                placeholder="p.sh. +355 69 123 4567"
              />
            </div>

            {/* Address */}
            <div>
              <label className="label flex items-center gap-1.5">
                <RiMapPinLine className="text-slate-400" />
                Adresa
              </label>
              <input
                type="text"
                value={adresa}
                onChange={(e) => setAdresa(e.target.value)}
                disabled={!isOwner}
                className="input"
                placeholder="p.sh. Rruga Myslym Shyri, Tiranë"
              />
            </div>

            {/* Tax ID / NIPT */}
            <div>
              <label className="label flex items-center gap-1.5">
                <RiFileListLine className="text-slate-400" />
                NIPT
                <span className="text-xs text-slate-400 font-normal">(opsional)</span>
              </label>
              <input
                type="text"
                value={nipt}
                onChange={(e) => setNipt(e.target.value)}
                disabled={!isOwner}
                className="input font-mono"
                placeholder="p.sh. K12345678A"
                maxLength={20}
              />
            </div>
          </div>

          {/* Logo placeholder */}
          <div className="card p-6 opacity-60">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">
              Logo e Biznesit
            </h2>
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                <RiImageLine className="text-slate-300 text-2xl" />
              </div>
              <p className="text-sm font-medium text-slate-500">Logo e Biznesit</p>
              <p className="text-xs text-slate-400 mt-1">Nuk është aktivizuar ende</p>
            </div>
          </div>

          {/* Save button — owner only */}
          {isOwner && (
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RiSaveLine className="text-base" />
                )}
                {saving ? 'Duke ruajtur...' : 'Ruaj Ndryshimet'}
              </button>
            </div>
          )}

          {!isOwner && (
            <p className="text-xs text-slate-400 text-center">
              Vetëm pronari mund të modifikojë profilin e biznesit.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

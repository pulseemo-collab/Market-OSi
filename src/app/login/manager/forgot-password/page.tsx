'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { RiStore2Line, RiArrowLeftLine, RiLoader4Line, RiMailLine } from 'react-icons/ri'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setSubmitted(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm">
            <RiStore2Line className="text-white text-xl" />
          </div>
          <div>
            <span className="text-slate-900 font-bold text-xl leading-none block">Market OS</span>
            <span className="text-slate-400 text-xs">Sistemi i Marketit</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <div className="flex items-center gap-3 mb-6">
            <Link
              href="/login/manager"
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
            >
              <RiArrowLeftLine className="text-base" />
            </Link>
            <h1 className="text-slate-900 font-semibold text-lg">Rivendos Fjalëkalimin</h1>
          </div>

          {submitted ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <RiMailLine className="text-green-600 text-xl" />
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Nëse ky email ekziston, do të marrësh një link për ndryshimin e fjalëkalimit.
              </p>
              <Link
                href="/login/manager"
                className="mt-6 inline-block text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                Kthehu te hyrja
              </Link>
            </div>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-5">
                Shkruaj emailin tënd dhe do të të dërgojmë një link për ndryshimin e fjalëkalimit.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    placeholder="email@shembull.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <RiLoader4Line className="animate-spin" />
                      Duke dërguar...
                    </>
                  ) : (
                    'Dërgo Linkun'
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Market OS — Sistem i menaxhimit të marketit
        </p>
      </div>
    </div>
  )
}

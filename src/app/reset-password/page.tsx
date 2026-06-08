'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { RiStore2Line, RiEyeLine, RiEyeOffLine, RiLoader4Line } from 'react-icons/ri'

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false)
  const [exchangeError, setExchangeError] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const readyRef = useRef(false)

  useEffect(() => {
    const supabase = createClient()

    // PKCE flow: code in query params
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(async ({ error }) => {
        if (error) {
          // Code exchange failed — check if a session already exists (e.g. code was already exchanged)
          const { data: { session } } = await supabase.auth.getSession()
          if (session) {
            readyRef.current = true
            setReady(true)
          } else {
            setExchangeError(true)
          }
        } else {
          readyRef.current = true
          setReady(true)
        }
      })
      return
    }

    // Implicit flow: hash tokens — Supabase fires PASSWORD_RECOVERY or SIGNED_IN
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        readyRef.current = true
        setReady(true)
      }
    })

    // Fallback: check if there's already a session (tokens processed before listener registered)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        readyRef.current = true
        setReady(true)
      }
    })

    // Also try parsing hash tokens explicitly if present
    const hash = window.location.hash
    if (hash) {
      const hashParams = new URLSearchParams(hash.substring(1))
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      if (accessToken) {
        supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken ?? '',
        }).then(({ error }) => {
          if (!error) {
            readyRef.current = true
            setReady(true)
          }
        })
      }
    }

    const timeout = setTimeout(() => {
      // Only redirect to error if the form hasn't been shown yet
      if (!readyRef.current) {
        setExchangeError(true)
      }
    }, 5000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  useEffect(() => {
    // Only redirect if we have an error AND the form was never made ready
    if (exchangeError && !ready) {
      router.replace('/login/manager?error=link_expired')
    }
  }, [exchangeError, ready, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    if (password !== confirmPassword) {
      setFormError('Fjalëkalimet nuk përputhen')
      return
    }

    if (password.length < 6) {
      setFormError('Fjalëkalimi duhet të ketë të paktën 6 karaktere')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setFormError('Gabim gjatë ndryshimit të fjalëkalimit. Provo sërish.')
      setLoading(false)
      return
    }

    await supabase.auth.signOut()
    router.push('/login/manager?success=password_updated')
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-slate-500">
          <RiLoader4Line className="animate-spin text-xl text-blue-600" />
          <span className="text-sm">Duke verifikuar linkun...</span>
        </div>
      </div>
    )
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
          <h1 className="text-slate-900 font-semibold text-lg mb-2">Fjalëkalim i Ri</h1>
          <p className="text-sm text-slate-500 mb-6">Vendos fjalëkalimin tënd të ri më poshtë.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Fjalëkalimi i ri
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition pr-10"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <RiEyeOffLine className="text-base" />
                  ) : (
                    <RiEyeLine className="text-base" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Konfirmo fjalëkalimin
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                placeholder="••••••••"
              />
            </div>

            {formError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 px-3.5 py-2.5 rounded-lg">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <RiLoader4Line className="animate-spin" />
                  Duke ruajtur...
                </>
              ) : (
                'Ndrysho fjalëkalimin'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Market OS — Sistem i menaxhimit të marketit
        </p>
      </div>
    </div>
  )
}

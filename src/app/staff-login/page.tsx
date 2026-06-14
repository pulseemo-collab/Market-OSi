'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RiStore2Line, RiDeleteBackLine, RiLockLine, RiUserLine } from 'react-icons/ri'

export default function StaffLoginPage() {
  const [emri, setEmri] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  // If the user already has a valid staff session, skip the login form.
  useEffect(() => {
    fetch('/api/staff-auth/session', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        console.log('[StaffLoginPage] existing session check:', data)
        if (data.session?.staffRole === 'Cashier') {
          console.log('[StaffLoginPage] already authenticated → /shitjet')
          window.location.href = '/shitjet'
        }
      })
      .catch(() => {})
  }, [])

  const handlePinDigit = (digit: string) => {
    if (pin.length >= 6) return
    setPin((prev) => prev + digit)
    setError('')
  }

  const handlePinDelete = () => {
    setPin((prev) => prev.slice(0, -1))
    setError('')
  }

  const handleLogin = useCallback(async () => {
    if (!emri.trim() || pin.length < 4 || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/staff-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ emri: emri.trim(), pin }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Gabim gjatë hyrjes')
        setPin('')
        return
      }
      window.location.href = '/shitjet'
    } catch {
      setError('Gabim gjatë hyrjes')
      setPin('')
    } finally {
      setLoading(false)
    }
  }, [emri, pin, loading])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement === nameRef.current) return
      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); handlePinDigit(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); handlePinDelete() }
      else if (e.key === 'Enter' && emri.trim() && pin.length >= 4) handleLogin()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emri, pin, handleLogin])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-600 rounded-2xl mb-4 shadow-lg shadow-emerald-600/25">
            <RiStore2Line className="text-white text-3xl" />
          </div>
          <h1 className="text-2xl font-bold text-white">Market OS</h1>
          <p className="text-slate-400 text-sm mt-1">Hyrja e Punonjësit</p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-800 rounded-2xl p-6 border border-slate-700"
        >
          {/* Name field */}
          <div className="mb-6">
            <label className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wide mb-2">
              <RiUserLine />
              Emër dhe mbiemër
            </label>
            <input
              ref={nameRef}
              type="text"
              value={emri}
              onChange={(e) => { setEmri(e.target.value); setError('') }}
              placeholder="p.sh. Arben Hoxha"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-slate-700 border border-slate-600 focus:border-emerald-500 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm outline-none transition-colors"
            />
          </div>

          {/* PIN label */}
          <div className="flex items-center gap-2 text-slate-400 text-xs font-medium uppercase tracking-wide mb-3">
            <RiLockLine />
            PIN / Fjalëkalim
          </div>

          {/* PIN dots */}
          <div className="flex justify-center gap-3 mb-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full transition-all duration-150 ${
                  i < pin.length ? 'bg-emerald-500 scale-110' : 'bg-slate-600'
                }`}
              />
            ))}
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-red-400 text-sm text-center mb-4 font-medium leading-snug"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Numpad */}
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <motion.button
                key={d}
                whileTap={{ scale: 0.93 }}
                onClick={() => handlePinDigit(d)}
                disabled={loading}
                className="h-16 rounded-xl bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white text-2xl font-semibold transition-colors disabled:opacity-50"
              >
                {d}
              </motion.button>
            ))}
            <div />
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={() => handlePinDigit('0')}
              disabled={loading}
              className="h-16 rounded-xl bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white text-2xl font-semibold transition-colors disabled:opacity-50"
            >
              0
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.93 }}
              onClick={handlePinDelete}
              disabled={loading}
              className="h-16 rounded-xl bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-slate-300 transition-colors flex items-center justify-center disabled:opacity-50"
            >
              <RiDeleteBackLine className="text-2xl" />
            </motion.button>
          </div>

          {/* Login button */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleLogin}
            disabled={!emri.trim() || pin.length < 4 || loading}
            className={`w-full mt-4 py-4 rounded-xl font-semibold text-base transition-all ${
              !emri.trim() || pin.length < 4 || loading
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/25'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Duke u identifikuar...
              </span>
            ) : 'Hyr'}
          </motion.button>
        </motion.div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Hyrje si Menaxher?{' '}
          <a href="/login/manager" className="text-slate-500 hover:text-slate-300 underline transition-colors">
            Hyrja e Menaxherit
          </a>
        </p>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { RiStore2Line, RiArrowLeftLine, RiEyeLine, RiEyeOffLine } from 'react-icons/ri'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

export default function RegisterPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [form, setForm] = useState({ dyqani: '', emri: '', telefoni: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.dyqani.trim()) e.dyqani = 'Emri i dyqanit është i detyrueshëm'
    if (!form.emri.trim()) e.emri = 'Emri i pronarit është i detyrueshëm'
    if (!form.telefoni.trim()) {
      e.telefoni = 'Numri i telefonit është i detyrueshëm'
    } else {
      const phone = form.telefoni.trim().replace(/[\s\-]/g, '')
      if (!/^(\+355\d{9}|0\d{9})$/.test(phone)) {
        e.telefoni = 'Numri i telefonit nuk është valid (p.sh. 069 123 4567 ose +355691234567)'
      }
    }
    if (!form.email.trim()) e.email = 'Email-i është i detyrueshëm'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Email-i nuk është valid'
    if (!form.password) e.password = 'Fjalëkalimi është i detyrueshëm'
    else if (form.password.length < 6) e.password = 'Fjalëkalimi duhet të ketë të paktën 6 karaktere'
    if (form.password !== form.confirm) e.confirm = 'Fjalëkalimet nuk përputhen'
    return e
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setErrors({})
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dyqani: form.dyqani.trim(),
          emri: form.emri.trim(),
          telefoni: form.telefoni.trim().replace(/[\s\-]/g, ''),
          email: form.email.trim(),
          password: form.password,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Gabim gjatë regjistrimit')
        return
      }

      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      })
      if (signInError) {
        toast.error('Llogaria u krijua por hyrja dështoi. Provo të hysh manualisht.')
        router.push('/login/manager')
        return
      }

      toast.success('Mirë se vini! Llogaria juaj u krijua me sukses.')
      router.push('/')
      router.refresh()
    } catch {
      toast.error('Gabim i papritur. Provo sërish.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg shadow-blue-600/25">
            <RiStore2Line className="text-white text-3xl" />
          </div>
          <h1 className="text-2xl font-bold text-white">Krijoni Dyqanin</h1>
          <p className="text-slate-400 text-sm mt-1">14 ditë provë falas, pa kartë krediti</p>
        </motion.div>

        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          {/* Store name */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Emri i dyqanit</label>
            <input
              type="text"
              value={form.dyqani}
              onChange={(e) => setForm((p) => ({ ...p, dyqani: e.target.value }))}
              placeholder="p.sh. Marketi Iliri"
              className={`w-full px-4 py-3 bg-slate-800 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.dyqani ? 'border-red-500' : 'border-slate-700'}`}
            />
            {errors.dyqani && <p className="text-red-400 text-xs mt-1">{errors.dyqani}</p>}
          </div>

          {/* Owner name */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Emri i pronarit</label>
            <input
              type="text"
              value={form.emri}
              onChange={(e) => setForm((p) => ({ ...p, emri: e.target.value }))}
              placeholder="p.sh. Ilir Hoxha"
              className={`w-full px-4 py-3 bg-slate-800 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.emri ? 'border-red-500' : 'border-slate-700'}`}
            />
            {errors.emri && <p className="text-red-400 text-xs mt-1">{errors.emri}</p>}
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Numri i Telefonit</label>
            <input
              type="tel"
              value={form.telefoni}
              onChange={(e) => setForm((p) => ({ ...p, telefoni: e.target.value }))}
              placeholder="p.sh. 069 123 4567"
              className={`w-full px-4 py-3 bg-slate-800 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.telefoni ? 'border-red-500' : 'border-slate-700'}`}
            />
            {errors.telefoni && <p className="text-red-400 text-xs mt-1">{errors.telefoni}</p>}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              placeholder="ju@shembull.com"
              className={`w-full px-4 py-3 bg-slate-800 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${errors.email ? 'border-red-500' : 'border-slate-700'}`}
            />
            {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Fjalëkalimi</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                placeholder="Minimumi 6 karaktere"
                className={`w-full px-4 py-3 bg-slate-800 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors pr-12 ${errors.password ? 'border-red-500' : 'border-slate-700'}`}
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
              >
                {showPass ? <RiEyeOffLine /> : <RiEyeLine />}
              </button>
            </div>
            {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Konfirmo fjalëkalimin</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={form.confirm}
                onChange={(e) => setForm((p) => ({ ...p, confirm: e.target.value }))}
                placeholder="Ripërsërit fjalëkalimin"
                className={`w-full px-4 py-3 bg-slate-800 border rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors pr-12 ${errors.confirm ? 'border-red-500' : 'border-slate-700'}`}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
              >
                {showConfirm ? <RiEyeOffLine /> : <RiEyeLine />}
              </button>
            </div>
            {errors.confirm && <p className="text-red-400 text-xs mt-1">{errors.confirm}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors mt-2"
          >
            {loading ? 'Duke krijuar...' : 'Krijoni llogarinë falas'}
          </button>
        </motion.form>

        <div className="mt-6 text-center space-y-3">
          <p className="text-slate-400 text-sm">
            Keni llogari?{' '}
            <Link href="/login/options" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
              Hyni këtu
            </Link>
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-400 text-xs transition-colors"
          >
            <RiArrowLeftLine />
            Kthehu
          </Link>
        </div>
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { RiStore2Line, RiLoginBoxLine, RiUserAddLine } from 'react-icons/ri'

export default function LoginSelectPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg shadow-blue-600/25">
            <RiStore2Line className="text-white text-3xl" />
          </div>
          <h1 className="text-2xl font-bold text-white">Market OS</h1>
          <p className="text-slate-400 text-sm mt-1">Sistem i menaxhimit të marketit</p>
        </motion.div>

        {/* Options */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="space-y-3"
        >
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              href="/login/options"
              className="flex items-center gap-4 w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 rounded-2xl p-5 transition-all group"
            >
              <div className="w-12 h-12 bg-blue-600/20 group-hover:bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors">
                <RiLoginBoxLine className="text-blue-400 group-hover:text-white text-2xl transition-colors" />
              </div>
              <div className="text-left">
                <p className="text-white font-semibold">Hyr</p>
                <p className="text-slate-400 text-sm">Hyr në llogarinë tuaj</p>
              </div>
            </Link>
          </motion.div>

          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              href="/register"
              className="flex items-center gap-4 w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-emerald-500 rounded-2xl p-5 transition-all group"
            >
              <div className="w-12 h-12 bg-emerald-600/20 group-hover:bg-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors">
                <RiUserAddLine className="text-emerald-400 group-hover:text-white text-2xl transition-colors" />
              </div>
              <div className="text-left">
                <p className="text-white font-semibold">Regjistrohu</p>
                <p className="text-slate-400 text-sm">Krijoni dyqanin tuaj — 14 ditë provë falas</p>
              </div>
            </Link>
          </motion.div>
        </motion.div>

        <p className="text-center text-slate-600 text-xs mt-8">
          Market OS — Sistem i menaxhimit të marketit
        </p>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { RiMenuLine, RiStore2Line } from 'react-icons/ri'
import Sidebar from './Sidebar'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  if (pathname === '/login') {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar — slides in on mobile, static on desktop */}
      <div
        className={`fixed inset-y-0 left-0 z-30 lg:static lg:translate-x-0 transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <Sidebar onClose={() => setOpen(false)} />
      </div>

      {/* Right side: top bar + page content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile-only top bar */}
        <header className="lg:hidden flex items-center gap-3 h-14 px-4 bg-white border-b border-slate-200 flex-shrink-0">
          <button
            onClick={() => setOpen(true)}
            className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Hap menunë"
          >
            <RiMenuLine className="text-xl" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <RiStore2Line className="text-white text-sm" />
            </div>
            <span className="font-bold text-slate-900">Market OS</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto min-h-0">
          {children}
        </main>
      </div>
    </div>
  )
}

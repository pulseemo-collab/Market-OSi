'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  RiDashboardLine,
  RiShoppingBasketLine,
  RiShoppingCartLine,
  RiHistoryLine,
  RiTruckLine,
  RiAlertLine,
  RiStore2Line,
  RiBox3Line,
} from 'react-icons/ri'

const navItems = [
  { href: '/', label: 'Paneli Kryesor', icon: RiDashboardLine },
  { href: '/produktet', label: 'Produktet', icon: RiShoppingBasketLine },
  { href: '/shitjet', label: 'Shitjet (POS)', icon: RiShoppingCartLine },
  { href: '/historiku', label: 'Historiku', icon: RiHistoryLine },
  { href: '/stok-i-ulet', label: 'Stok i Ulët', icon: RiAlertLine },
  { href: '/furnizime', label: 'Furnizime', icon: RiBox3Line },
  { href: '/furnitoret', label: 'Furnitorët', icon: RiTruckLine },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <RiStore2Line className="text-white text-lg" />
          </div>
          <div>
            <span className="text-slate-900 font-bold text-base leading-none block">Market OS</span>
            <span className="text-slate-400 text-xs">Sistemi i Marketit</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <Icon
                className={cn(
                  'text-lg flex-shrink-0',
                  isActive ? 'text-blue-600' : 'text-slate-400'
                )}
              />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-100">
        <p className="text-xs text-slate-400">Market OS v1.0</p>
      </div>
    </aside>
  )
}

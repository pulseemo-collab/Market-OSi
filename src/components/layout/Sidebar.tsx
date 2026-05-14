'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/contexts/RoleContext'
import { Role, ROLE_LABELS } from '@/lib/roles'
import {
  RiDashboardLine,
  RiShoppingBasketLine,
  RiShoppingCartLine,
  RiHistoryLine,
  RiTruckLine,
  RiAlertLine,
  RiStore2Line,
  RiBox3Line,
  RiLogoutBoxRLine,
  RiFileListLine,
  RiTeamLine,
  RiShieldUserLine,
} from 'react-icons/ri'

const navItems = [
  { href: '/', label: 'Paneli Kryesor', icon: RiDashboardLine, allowed: ['admin'] as Role[] },
  { href: '/produktet', label: 'Produktet', icon: RiShoppingBasketLine, allowed: ['admin', 'staff'] as Role[] },
  { href: '/shitjet', label: 'Shitjet (POS)', icon: RiShoppingCartLine, allowed: ['admin', 'cashier'] as Role[] },
  { href: '/historiku', label: 'Historiku', icon: RiHistoryLine, allowed: ['admin', 'cashier'] as Role[] },
  { href: '/stok-i-ulet', label: 'Stok i Ulët', icon: RiAlertLine, allowed: ['admin', 'staff'] as Role[] },
  { href: '/porositje-te-sugjeruara', label: 'Porositje Sugjeruara', icon: RiFileListLine, allowed: ['admin', 'staff'] as Role[] },
  { href: '/furnizime', label: 'Furnizime', icon: RiBox3Line, allowed: ['admin', 'staff'] as Role[] },
  { href: '/furnitoret', label: 'Furnitorët', icon: RiTruckLine, allowed: ['admin', 'staff'] as Role[] },
  { href: '/perdoruesit', label: 'Përdoruesit', icon: RiTeamLine, allowed: ['admin'] as Role[] },
]

interface SidebarProps {
  onClose?: () => void
}

export default function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { role } = useRole()

  if (pathname === '/login') return null

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const visibleItems = navItems.filter(
    (item) => role !== null && item.allowed.includes(role)
  )

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
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
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
      <div className="px-3 py-4 border-t border-slate-100 space-y-1">
        {role && (
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <RiShieldUserLine className="text-slate-400 text-base flex-shrink-0" />
            <span className="text-xs text-slate-400">
              {ROLE_LABELS[role]}
            </span>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-all duration-150 group"
        >
          <RiLogoutBoxRLine className="text-lg flex-shrink-0 text-slate-400 group-hover:text-red-500" />
          Dil
        </button>
        <p className="text-xs text-slate-400 px-3">Market OS v1.0</p>
      </div>
    </aside>
  )
}

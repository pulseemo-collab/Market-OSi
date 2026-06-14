'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/contexts/RoleContext'
import { Role, ROLE_LABELS } from '@/lib/roles'
import { useSubscriptionDetails } from '@/hooks/useSubscription'
import type { ClientStaffSession } from './ClientLayout'
import toast from 'react-hot-toast'
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
  RiShieldUserLine,
  RiGlobalLine,
  RiSettings3Line,
  RiAdminLine,
} from 'react-icons/ri'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  allowed: Role[]
}

const mainNavItems: NavItem[] = [
  { href: '/', label: 'Paneli Kryesor', icon: RiDashboardLine, allowed: ['Administrator', 'Manager'] as Role[] },
  { href: '/produktet', label: 'Produktet', icon: RiShoppingBasketLine, allowed: ['Administrator', 'Manager'] as Role[] },
  { href: '/shitjet', label: 'Shitjet (POS)', icon: RiShoppingCartLine, allowed: ['Administrator', 'Manager', 'Cashier'] as Role[] },
  { href: '/historiku', label: 'Historiku', icon: RiHistoryLine, allowed: ['Administrator', 'Manager', 'Cashier'] as Role[] },
  { href: '/stok-i-ulet', label: 'Stok i Ulët', icon: RiAlertLine, allowed: ['Administrator', 'Manager'] as Role[] },
  { href: '/porositje-te-sugjeruara', label: 'Porositje Sugjeruara', icon: RiFileListLine, allowed: ['Administrator', 'Manager'] as Role[] },
  { href: '/furnizime', label: 'Furnizime', icon: RiBox3Line, allowed: ['Administrator', 'Manager'] as Role[] },
  { href: '/furnitoret', label: 'Furnitorët', icon: RiTruckLine, allowed: ['Administrator', 'Manager'] as Role[] },
]

const bottomNavItems: NavItem[] = [
  { href: '/administrim', label: 'Administrim', icon: RiAdminLine, allowed: ['Administrator', 'Manager'] as Role[] },
  { href: '/cilesime', label: 'Cilësimet', icon: RiSettings3Line, allowed: ['Administrator', 'Manager'] as Role[] },
  { href: '/platforma', label: 'Platforma', icon: RiGlobalLine, allowed: ['platform_owner'] as Role[] },
]

// Navigation visible to PIN staff after login
const STAFF_NAV_ITEMS = [
  { href: '/shitjet', label: 'Shitjet (POS)', icon: RiShoppingCartLine },
  { href: '/historiku', label: 'Historiku', icon: RiHistoryLine },
]

interface SidebarProps {
  onClose?: () => void
  orgName?: string | null
  staffSession?: ClientStaffSession | null
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function NavLink({
  item,
  pathname,
  onClose,
  badge,
}: {
  item: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }
  pathname: string
  onClose?: () => void
  badge?: number
}) {
  const Icon = item.icon
  const isActive = item.href === '/'
    ? pathname === '/'
    : pathname === item.href || pathname.startsWith(item.href + '/')
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
      <span className="flex-1">{item.label}</span>
      {badge != null && badge > 0 && (
        <span className="min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  )
}

export default function Sidebar({ onClose, orgName, staffSession = null }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { role } = useRole()

  const showSubStatus = role === 'Administrator' || role === 'Manager'
  const subDetails = useSubscriptionDetails(showSubStatus)

  // Hide sidebar on all auth pages
  const isAuthPage =
    pathname === '/login' ||
    pathname === '/login/options' ||
    pathname === '/register' ||
    pathname === '/staff-login' ||
    pathname === '/login/manager'
  if (isAuthPage) return null

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('U largove me sukses')
    router.push('/login')
    router.refresh()
  }

  const handleStaffLogout = async () => {
    await fetch('/api/staff-auth/logout', { method: 'POST' })
    toast.success('U largove me sukses')
    router.push('/staff-login')
    router.refresh()
  }

  const isStaffMode = role === null && staffSession !== null

  const visibleMain = role !== null ? mainNavItems.filter((item) => item.allowed.includes(role)) : []
  const visibleBottom = role !== null ? bottomNavItems.filter((item) => item.allowed.includes(role)) : []
  const staffItems = isStaffMode ? STAFF_NAV_ITEMS : []

  const displayRole = role
    ? ROLE_LABELS[role]
    : staffSession
      ? staffSession.staffRole === 'Cashier'
        ? 'Kasijer (PIN)'
        : 'Staff (PIN)'
      : null

  const displayOrgName = isStaffMode
    ? (staffSession?.organizationName || 'Market OS')
    : (orgName || 'Market OS')

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <RiStore2Line className="text-white text-lg" />
          </div>
          <div className="min-w-0">
            <span className="text-slate-900 font-bold text-base leading-none block truncate">
              {displayOrgName}
            </span>
            <span className="text-slate-400 text-xs">Sistemi i Marketit</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
        {/* PIN staff */}
        {isStaffMode && staffItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onClose={onClose} />
        ))}

        {/* Main operations */}
        {visibleMain.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onClose={onClose} />
        ))}

        {/* Bottom items (Administrim, Cilësimet, Platforma) */}
        {visibleBottom.length > 0 && (
          <div className="pt-3 space-y-0.5">
            {visibleBottom.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} onClose={onClose} />
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-slate-100 space-y-1">
        {showSubStatus && !subDetails.loading && (subDetails.subStatus === 'trialing' || subDetails.subStatus === 'active') && (
          <div className="px-3 py-1.5 mb-1 space-y-0.5">
            {subDetails.plan && (
              <span className="text-xs text-slate-500 block">
                Plan: {subDetails.plan === 'yearly' ? 'Vjetor' : subDetails.plan === 'monthly' ? 'Mujor' : subDetails.plan}
              </span>
            )}
            {subDetails.subStatus === 'trialing' && subDetails.trialDaysLeft !== null ? (
              <span className="text-xs text-amber-600 font-medium block">
                Trial: {subDetails.trialDaysLeft} ditë të mbetura
              </span>
            ) : subDetails.subStatus === 'active' && subDetails.periodEndsAt ? (
              <span className="text-xs text-green-600 font-medium block">
                Abonimi aktiv deri më: {formatDate(subDetails.periodEndsAt)}
              </span>
            ) : null}
          </div>
        )}
        {displayRole && (
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <RiShieldUserLine className="text-slate-400 text-base flex-shrink-0" />
            <div className="min-w-0">
              {isStaffMode && staffSession && (
                <span className="text-xs font-medium text-slate-700 block truncate">
                  {staffSession.staffName}
                </span>
              )}
              <span className="text-xs text-slate-400">{displayRole}</span>
            </div>
          </div>
        )}
        <button
          onClick={isStaffMode ? handleStaffLogout : handleLogout}
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

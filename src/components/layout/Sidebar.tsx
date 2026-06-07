'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/contexts/RoleContext'
import { Role, ROLE_LABELS } from '@/lib/roles'
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
  RiTeamLine,
  RiShieldUserLine,
  RiFileSearchLine,
  RiSave3Line,
  RiBellLine,
  RiGlobalLine,
  RiFingerprint2Line,
} from 'react-icons/ri'

const navItems = [
  { href: '/', label: 'Paneli Kryesor', icon: RiDashboardLine, allowed: ['owner', 'manager'] as Role[] },
  { href: '/produktet', label: 'Produktet', icon: RiShoppingBasketLine, allowed: ['owner', 'manager', 'employee'] as Role[] },
  { href: '/shitjet', label: 'Shitjet (POS)', icon: RiShoppingCartLine, allowed: ['owner', 'cashier'] as Role[] },
  { href: '/historiku', label: 'Historiku', icon: RiHistoryLine, allowed: ['owner', 'manager', 'cashier'] as Role[] },
  { href: '/stok-i-ulet', label: 'Stok i Ulët', icon: RiAlertLine, allowed: ['owner', 'manager'] as Role[] },
  { href: '/porositje-te-sugjeruara', label: 'Porositje Sugjeruara', icon: RiFileListLine, allowed: ['owner', 'manager'] as Role[] },
  { href: '/furnizime', label: 'Furnizime', icon: RiBox3Line, allowed: ['owner', 'manager'] as Role[] },
  { href: '/furnitoret', label: 'Furnitorët', icon: RiTruckLine, allowed: ['owner', 'manager'] as Role[] },
  { href: '/perdoruesit', label: 'Përdoruesit', icon: RiTeamLine, allowed: ['owner'] as Role[] },
  { href: '/personal', label: 'Personal PIN', icon: RiFingerprint2Line, allowed: ['owner', 'manager'] as Role[] },
  { href: '/regjistri', label: 'Regjistri Auditimit', icon: RiFileSearchLine, allowed: ['owner'] as Role[] },
  { href: '/backup', label: 'Backup & Rikuperim', icon: RiSave3Line, allowed: ['owner'] as Role[] },
  { href: '/njoftime', label: 'Njoftime', icon: RiBellLine, allowed: ['owner', 'manager', 'cashier'] as Role[] },
  { href: '/platforma', label: 'Platforma', icon: RiGlobalLine, allowed: ['platform_owner'] as Role[] },
]

// Navigation visible to PIN staff after login
const STAFF_NAV_ITEMS = [
  { href: '/shitjet', label: 'Shitjet (POS)', icon: RiShoppingCartLine },
  { href: '/historiku', label: 'Historiku', icon: RiHistoryLine },
]

interface StaffSession {
  staffId: number
  staffName: string
  staffRole: string
  organizationId: number
}

interface SidebarProps {
  onClose?: () => void
}

export default function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { role } = useRole()
  const [unreadCount, setUnreadCount] = useState(0)
  const [staffSession, setStaffSession] = useState<StaffSession | null>(null)
  const [staffLoading, setStaffLoading] = useState(true)

  const canSeeNotifications = role === 'owner' || role === 'manager' || role === 'cashier'

  // Detect PIN staff session when there's no Supabase role.
  // Re-run on pathname so a new login immediately shows the correct name.
  useEffect(() => {
    if (role !== null) {
      setStaffLoading(false)
      return
    }
    setStaffLoading(true)
    fetch('/api/staff-auth/session')
      .then((r) => r.json())
      .then((data) => setStaffSession(data.session ?? null))
      .catch(() => setStaffSession(null))
      .finally(() => setStaffLoading(false))
  }, [role, pathname])

  const fetchUnreadCount = useCallback(async () => {
    if (!canSeeNotifications) return
    try {
      const res = await fetch('/api/notifications?countOnly=true')
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.unreadCount ?? 0)
      }
    } catch {}
  }, [canSeeNotifications])

  useEffect(() => {
    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 30000)
    return () => clearInterval(interval)
  }, [fetchUnreadCount])

  // Hide sidebar on all auth pages
  const isAuthPage = pathname === '/login' || pathname === '/staff-login' || pathname === '/login/manager'
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
    setStaffSession(null)
    toast.success('U largove me sukses')
    router.push('/staff-login')
    router.refresh()
  }

  const isStaffMode = role === null && staffSession !== null

  const visibleItems = role !== null
    ? navItems.filter((item) => item.allowed.includes(role))
    : isStaffMode
      ? STAFF_NAV_ITEMS
      : []

  const displayRole = role
    ? ROLE_LABELS[role]
    : staffSession
      ? staffSession.staffRole === 'cashier'
        ? 'Kasijer (PIN)'
        : 'Punonjës (PIN)'
      : null

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
          const isNotifications = item.href === '/njoftime'
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
              {isNotifications && unreadCount > 0 && (
                <span className="min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-slate-100 space-y-1">
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

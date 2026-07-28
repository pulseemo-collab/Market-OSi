'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRole } from '@/contexts/RoleContext'
import { cn, formatRelativeTime } from '@/lib/utils'
import { setNotificationCount, useNotificationCount } from '@/hooks/useNotificationCount'
import {
  RiBellLine,
  RiCheckLine,
  RiCheckDoubleLine,
  RiAlertLine,
  RiSave3Line,
  RiShoppingCartLine,
  RiErrorWarningLine,
  RiCheckboxCircleLine,
} from 'react-icons/ri'

interface Notification {
  id: number
  type: string
  title: string
  message: string
  severity: string
  isRead: boolean
  createdAt: string
}

const SEVERITY_DOT: Record<string, string> = {
  low:      'bg-slate-400',
  medium:   'bg-blue-500',
  high:     'bg-amber-500',
  critical: 'bg-red-500',
}

const TYPE_ICON: Record<string, React.ElementType> = {
  LOW_STOCK:       RiAlertLine,
  BACKUP_SUCCESS:  RiSave3Line,
  BACKUP_FAILED:   RiErrorWarningLine,
  RESTORE_SUCCESS: RiCheckboxCircleLine,
  RESTORE_FAILED:  RiErrorWarningLine,
  LARGE_SALE:      RiShoppingCartLine,
  SYSTEM_ERROR:    RiErrorWarningLine,
}

const TYPE_ICON_COLOR: Record<string, string> = {
  LOW_STOCK:       'text-amber-500',
  BACKUP_SUCCESS:  'text-emerald-500',
  BACKUP_FAILED:   'text-red-500',
  RESTORE_SUCCESS: 'text-emerald-500',
  RESTORE_FAILED:  'text-red-500',
  LARGE_SALE:      'text-blue-500',
  SYSTEM_ERROR:    'text-red-500',
}

export default function NotificationBell() {
  const { role } = useRole()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const canSee = role === 'Administrator' || role === 'Manager' || role === 'Cashier'

  // The badge count comes from the shared hook, which runs a single poller for
  // the whole page. This component used to run a second one against the same
  // endpoint, so every open tab polled it twice.
  const unreadCount = useNotificationCount(canSee)

  const fetchNotifications = useCallback(async () => {
    if (!canSee) return
    setLoading(true)
    try {
      const res = await fetch('/api/notifications?limit=10')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications ?? [])
        setNotificationCount(data.unreadCount ?? 0)
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }, [canSee])

  useEffect(() => {
    if (open) fetchNotifications()
  }, [open, fetchNotifications])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const markAsRead = async (id: number) => {
    // Optimistic update
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
    setNotificationCount(unreadCount - 1)
    try {
      await fetch(`/api/notifications/${id}`, { method: 'PATCH' })
    } catch {
      // Rollback
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: false } : n)))
      setNotificationCount(unreadCount)
    }
  }

  const markAllRead = async () => {
    setMarkingAll(true)
    const snapshot = { notifications, unreadCount }
    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
    setNotificationCount(0)
    try {
      await fetch('/api/notifications/mark-all-read', { method: 'POST' })
    } catch {
      // Rollback
      setNotifications(snapshot.notifications)
      setNotificationCount(snapshot.unreadCount)
    } finally {
      setMarkingAll(false)
    }
  }

  if (!canSee) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
        aria-label="Njoftime"
      >
        <RiBellLine className="text-xl" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">Njoftime</span>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={markingAll}
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-50 transition-colors"
              >
                <RiCheckDoubleLine />
                Shëno të gjitha
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="py-8 flex justify-center">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-10 text-center">
                <RiBellLine className="text-2xl text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Nuk ka njoftime</p>
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? RiBellLine
                const iconColor = TYPE_ICON_COLOR[n.type] ?? 'text-slate-400'
                return (
                  <div
                    key={n.id}
                    className={cn(
                      'px-4 py-3 border-b border-slate-50 last:border-0 flex items-start gap-3 transition-colors',
                      !n.isRead ? 'bg-blue-50/40' : 'hover:bg-slate-50/60'
                    )}
                  >
                    <Icon className={cn('text-lg flex-shrink-0 mt-0.5', iconColor)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-1.5">
                        <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0', SEVERITY_DOT[n.severity] ?? 'bg-slate-400')} />
                        <p className="text-xs font-semibold text-slate-800 leading-tight">{n.title}</p>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 pl-3">{n.message}</p>
                      <p className="text-[10px] text-slate-400 mt-1 pl-3">{formatRelativeTime(n.createdAt)}</p>
                    </div>
                    {!n.isRead && (
                      <button
                        onClick={() => markAsRead(n.id)}
                        className="text-blue-400 hover:text-blue-600 flex-shrink-0 mt-0.5 transition-colors"
                        title="Shëno si të lexuar"
                      >
                        <RiCheckLine className="text-base" />
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/80">
            <Link
              href="/njoftime"
              onClick={() => setOpen(false)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
            >
              Shiko të gjitha njoftime →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

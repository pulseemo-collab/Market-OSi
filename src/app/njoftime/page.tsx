'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import SubscriptionExpired from '@/components/SubscriptionExpired'
import { useSubscription } from '@/hooks/useSubscription'
import PageHeader from '@/components/ui/PageHeader'
import { formatDateTime, formatRelativeTime, cn } from '@/lib/utils'
import {
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_SEVERITY_LABELS,
} from '@/lib/notifications'
import toast from 'react-hot-toast'
import {
  RiBellLine,
  RiAlertLine,
  RiSave3Line,
  RiShoppingCartLine,
  RiErrorWarningLine,
  RiCheckboxCircleLine,
  RiCheckDoubleLine,
  RiCheckLine,
  RiFilterLine,
  RiRefreshLine,
} from 'react-icons/ri'

interface Notification {
  id: number
  type: string
  title: string
  message: string
  severity: string
  isRead: boolean
  metadata: Record<string, unknown> | null
  createdAt: string
}

const SEVERITY_STYLES: Record<string, { badge: string; dot: string; row: string }> = {
  low:      { badge: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400',  row: '' },
  medium:   { badge: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500',   row: '' },
  high:     { badge: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500',  row: 'border-l-2 border-amber-400' },
  critical: { badge: 'bg-red-100 text-red-700',       dot: 'bg-red-500',    row: 'border-l-2 border-red-500' },
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

type FilterType = 'all' | 'unread'

export default function NjoftimePage() {
  const { role } = useRole()
  const subscription = useSubscription()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')
  const [markingAll, setMarkingAll] = useState(false)
  const [markingId, setMarkingId] = useState<number | null>(null)

  const canAccess = role === 'Administrator' || role === 'Manager' || role === 'Cashier'

  const fetchNotifications = useCallback(async () => {
    if (!canAccess) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (filter === 'unread') params.set('unreadOnly', 'true')
      const res = await fetch(`/api/notifications?${params}`)
      if (!res.ok) throw new Error('Gabim')
      const data = await res.json()
      setNotifications(data.notifications ?? [])
      setUnreadCount(data.unreadCount ?? 0)
    } catch {
      toast.error('Gabim gjatë ngarkimit të njoftimeve')
    } finally {
      setLoading(false)
    }
  }, [canAccess, filter])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const markAsRead = async (id: number) => {
    // Optimistic update + immediate sidebar refresh
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
    setUnreadCount((prev) => Math.max(0, prev - 1))
    window.dispatchEvent(new Event('notifications-updated'))
    setMarkingId(id)
    try {
      const res = await fetch(`/api/notifications/${id}`, { method: 'PATCH' })
      if (!res.ok) throw new Error()
    } catch {
      // Rollback
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: false } : n)))
      setUnreadCount((prev) => prev + 1)
      window.dispatchEvent(new Event('notifications-updated'))
      toast.error('Gabim gjatë shënimit')
    } finally {
      setMarkingId(null)
    }
  }

  const markAllAsRead = async () => {
    const snapshot = { notifications, unreadCount }
    // Optimistic update + immediate sidebar refresh
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
    setUnreadCount(0)
    window.dispatchEvent(new Event('notifications-updated'))
    setMarkingAll(true)
    try {
      const res = await fetch('/api/notifications/mark-all-read', { method: 'POST' })
      if (!res.ok) throw new Error()
      toast.success('Të gjitha njoftime u shënuan si të lexuara')
    } catch {
      // Rollback
      setNotifications(snapshot.notifications)
      setUnreadCount(snapshot.unreadCount)
      window.dispatchEvent(new Event('notifications-updated'))
      toast.error('Gabim gjatë shënimit')
    } finally {
      setMarkingAll(false)
    }
  }

  if (!canAccess) return <AccessDenied />
  if (subscription === 'blocked') return <SubscriptionExpired />

  const displayed = notifications

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Njoftime"
        subtitle="Shikoni njoftime të rëndësishme të sistemit dhe biznesit"
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Filter tabs */}
        <div className="flex bg-slate-100 rounded-lg p-1 gap-1">
          {(['all', 'unread'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                filter === f
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {f === 'all' ? 'Të gjitha' : `Pa lexuar${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={fetchNotifications}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <RiRefreshLine className={cn('text-base', loading && 'animate-spin')} />
            Rifresko
          </button>

          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              disabled={markingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
            >
              {markingAll ? (
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <RiCheckDoubleLine className="text-base" />
              )}
              Shëno të gjitha si të lexuara
            </button>
          )}
        </div>
      </div>

      {/* Notifications list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-slate-200 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-1/3" />
                  <div className="h-3 bg-slate-200 rounded w-2/3" />
                  <div className="h-3 bg-slate-200 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-12 text-center"
        >
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <RiBellLine className="text-slate-400 text-3xl" />
          </div>
          <p className="text-base font-semibold text-slate-700 mb-1">
            {filter === 'unread' ? 'Nuk ka njoftime pa lexuar' : 'Nuk ka njoftime'}
          </p>
          <p className="text-sm text-slate-400">
            {filter === 'unread'
              ? 'Të gjitha njoftime janë shënuar si të lexuara.'
              : 'Njoftime të reja do të shfaqen këtu automatikisht.'}
          </p>
        </motion.div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {displayed.map((n, idx) => {
              const Icon = TYPE_ICON[n.type] ?? RiBellLine
              const iconColor = TYPE_ICON_COLOR[n.type] ?? 'text-slate-400'
              const sev = SEVERITY_STYLES[n.severity] ?? SEVERITY_STYLES.medium
              const typeLabel = NOTIFICATION_TYPE_LABELS[n.type as keyof typeof NOTIFICATION_TYPE_LABELS] ?? n.type
              const sevLabel = NOTIFICATION_SEVERITY_LABELS[n.severity as keyof typeof NOTIFICATION_SEVERITY_LABELS] ?? n.severity
              return (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={cn(
                    'card p-4 flex items-start gap-4 transition-colors duration-150',
                    !n.isRead && 'bg-blue-50/30',
                    sev.row
                  )}
                >
                  {/* Icon */}
                  <div className={cn(
                    'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
                    n.isRead ? 'bg-slate-100' : 'bg-white border border-slate-200'
                  )}>
                    <Icon className={cn('text-lg', n.isRead ? 'text-slate-400' : iconColor)} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <div className={cn('w-2 h-2 rounded-full flex-shrink-0', sev.dot)} />
                      <span className={cn(
                        'text-sm font-semibold',
                        n.isRead ? 'text-slate-600' : 'text-slate-900'
                      )}>
                        {n.title}
                      </span>
                      <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full', sev.badge)}>
                        {sevLabel}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        {typeLabel}
                      </span>
                      {!n.isRead && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium ml-auto">
                          E re
                        </span>
                      )}
                    </div>
                    <p className={cn('text-sm', n.isRead ? 'text-slate-500' : 'text-slate-700')}>
                      {n.message}
                    </p>
                    <p className="text-xs text-slate-400 mt-1" title={formatDateTime(n.createdAt)}>
                      {formatRelativeTime(n.createdAt)} · {formatDateTime(n.createdAt)}
                    </p>
                  </div>

                  {/* Mark as read */}
                  {!n.isRead && (
                    <button
                      onClick={() => markAsRead(n.id)}
                      disabled={markingId === n.id}
                      title="Shëno si të lexuar"
                      className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                      {markingId === n.id ? (
                        <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <RiCheckLine className="text-base" />
                      )}
                    </button>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Stats footer */}
      {!loading && displayed.length > 0 && (
        <p className="text-xs text-slate-400 text-center mt-6">
          {displayed.length} njoftime · {unreadCount} pa lexuar
        </p>
      )}
    </div>
  )
}

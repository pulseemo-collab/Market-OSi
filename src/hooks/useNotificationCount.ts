'use client'

import { useEffect, useState } from 'react'

// Module-level cache: all hook instances share the same count immediately
let _cachedCount = 0
const _listeners = new Set<() => void>()

function _broadcast() {
  _listeners.forEach((fn) => fn())
}

/**
 * Publishes a count obtained elsewhere — the notification bell already receives
 * `unreadCount` with every list fetch, and applies optimistic updates when
 * marking items read.
 *
 * Routing those through here keeps the sidebar badge and the bell badge in
 * agreement, and means the unread count only needs one poller for the whole
 * page instead of one per component.
 */
export function setNotificationCount(count: number): void {
  _cachedCount = Math.max(0, count)
  _broadcast()
}

export function useNotificationCount(enabled = true): number {
  const [count, setCount] = useState(_cachedCount)

  useEffect(() => {
    if (!enabled) {
      setCount(0)
      return
    }

    // Sync with current cache value immediately (may have been fetched by sidebar)
    setCount(_cachedCount)

    const fetchCount = async () => {
      try {
        const res = await fetch('/api/notifications?countOnly=true')
        if (!res.ok) return
        const data = await res.json()
        _cachedCount = data.unreadCount ?? 0
        setCount(_cachedCount)
        _broadcast()
      } catch {
        // silent — sidebar badge is non-critical
      }
    }

    // Listen for cache updates from other hook instances
    const listener = () => setCount(_cachedCount)
    _listeners.add(listener)

    fetchCount()

    const handler = () => fetchCount()
    window.addEventListener('notifications-updated', handler)
    const interval = setInterval(fetchCount, 60_000)

    return () => {
      _listeners.delete(listener)
      window.removeEventListener('notifications-updated', handler)
      clearInterval(interval)
    }
  }, [enabled])

  return count
}

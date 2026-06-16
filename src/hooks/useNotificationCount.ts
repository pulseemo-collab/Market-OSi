'use client'

import { useEffect, useState } from 'react'

export function useNotificationCount(enabled = true): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setCount(0)
      return
    }

    const fetchCount = async () => {
      try {
        const res = await fetch('/api/notifications?countOnly=true')
        if (!res.ok) return
        const data = await res.json()
        setCount(data.unreadCount ?? 0)
      } catch {
        // silent — sidebar badge is non-critical
      }
    }

    fetchCount()

    const handler = () => fetchCount()
    window.addEventListener('notifications-updated', handler)
    const interval = setInterval(fetchCount, 60_000)

    return () => {
      window.removeEventListener('notifications-updated', handler)
      clearInterval(interval)
    }
  }, [enabled])

  return count
}

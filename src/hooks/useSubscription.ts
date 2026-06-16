'use client'

import { useEffect, useState } from 'react'

type SubStatus = 'loading' | 'allowed' | 'blocked'

export function useSubscription(): SubStatus {
  const [status, setStatus] = useState<SubStatus>('loading')

  useEffect(() => {
    fetch('/api/subscription-status')
      .then((r) => r.json())
      .then((d: { allowed?: boolean }) => setStatus(d.allowed === false ? 'blocked' : 'allowed'))
      .catch(() => setStatus('allowed'))
  }, [])

  return status
}

export interface SubscriptionDetails {
  loading: boolean
  subStatus?: string | null
  trialDaysLeft?: number | null
  periodEndsAt?: string | null
  plan?: string | null
}

export function useSubscriptionDetails(enabled = true): SubscriptionDetails {
  const [details, setDetails] = useState<SubscriptionDetails>({ loading: enabled })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1)
    window.addEventListener('subscription-updated', handler)
    return () => window.removeEventListener('subscription-updated', handler)
  }, [])

  useEffect(() => {
    if (!enabled) {
      setDetails({ loading: false })
      return
    }
    fetch('/api/subscription-status')
      .then((r) => r.json())
      .then((d) =>
        setDetails({
          loading: false,
          subStatus: d.subStatus ?? null,
          trialDaysLeft: d.trialDaysLeft ?? null,
          periodEndsAt: d.periodEndsAt ?? null,
          plan: d.plan ?? null,
        })
      )
      .catch(() => setDetails({ loading: false }))
  }, [enabled, refreshKey])

  return details
}

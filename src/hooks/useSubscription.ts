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

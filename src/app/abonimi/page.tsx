'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AbonimitRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/cilesime/abonimi')
  }, [router])
  return null
}

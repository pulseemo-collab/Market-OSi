'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function BackupRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/cilesime/backup')
  }, [router])
  return null
}

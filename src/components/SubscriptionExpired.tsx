'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useRole } from '@/contexts/RoleContext'
import { useSubscriptionDetails } from '@/hooks/useSubscription'
import { RiLockLine, RiPhoneLine } from 'react-icons/ri'

export default function SubscriptionExpired() {
  const router = useRouter()
  const { role } = useRole()
  const { subStatus } = useSubscriptionDetails()
  const isOwnerOrManager = role === 'owner' || role === 'manager'

  useEffect(() => {
    if (isOwnerOrManager) {
      router.replace('/abonimi')
    }
  }, [isOwnerOrManager, router])

  if (isOwnerOrManager) {
    return null
  }

  const title =
    subStatus === 'cancelled'
      ? 'Triali juaj është anuluar'
      : subStatus === 'expired'
      ? 'Trial-i juaj ka përfunduar'
      : 'Abonimi ka skaduar'

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="text-center max-w-sm mx-auto">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <RiLockLine className="text-3xl text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-sm text-slate-500 leading-relaxed mb-6">
          Kontaktoni administratorin e platformës për të riaktivizuar aksesin tuaj.
        </p>
        <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
          <RiPhoneLine className="text-base" />
          <span>Kontaktoni administratorin e platformës</span>
        </div>
      </div>
    </div>
  )
}

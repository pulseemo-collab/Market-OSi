'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useRole } from '@/contexts/RoleContext'
import { useSubscriptionDetails } from '@/hooks/useSubscription'
import { RiLockLine, RiPhoneLine, RiLoader4Line, RiShieldCrossLine } from 'react-icons/ri'

export default function SubscriptionExpired() {
  const router = useRouter()
  const { role } = useRole()
  const { loading, subStatus, orgSuspended } = useSubscriptionDetails()
  const isOwnerOrManager = role === 'Administrator' || role === 'Manager'

  // An owner or manager can act on a billing lapse, so send them to the page
  // where they can. A platform suspension is not theirs to clear — paying will
  // not lift it — so they are told what happened instead of being redirected.
  const shouldRedirect = isOwnerOrManager && !loading && !orgSuspended

  useEffect(() => {
    if (shouldRedirect) router.replace('/cilesime/abonimi')
  }, [shouldRedirect, router])

  // Never return null here. This component is the whole page body for a blocked
  // tenant, and rendering nothing while a redirect is pending or a fetch is in
  // flight leaves the user staring at a blank screen with no explanation.
  if (loading || shouldRedirect) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-8">
        <div className="flex items-center gap-3 text-slate-400">
          <RiLoader4Line className="animate-spin text-xl text-blue-500" />
          <span className="text-sm">Duke kontrolluar abonimin...</span>
        </div>
      </div>
    )
  }

  const title = orgSuspended
    ? 'Marketi është pezulluar'
    : subStatus === 'cancelled'
    ? 'Abonimi juaj është anuluar'
    : subStatus === 'trialing'
    ? 'Periudha e provës ka skaduar'
    : 'Perioda e abonimit ka skaduar'

  const body = orgSuspended
    ? 'Aksesi është bllokuar nga administratori i platformës. Të dhënat e marketit ruhen të paprekura dhe rikthehen sapo marketi të riaktivizohet.'
    : 'Kontaktoni administratorin e platformës për të riaktivizuar aksesin tuaj.'

  const Icon = orgSuspended ? RiShieldCrossLine : RiLockLine

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="text-center max-w-sm mx-auto">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <Icon className="text-3xl text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-sm text-slate-500 leading-relaxed mb-6">{body}</p>
        <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
          <RiPhoneLine className="text-base" />
          <span>Kontaktoni administratorin e platformës</span>
        </div>
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useRole } from '@/contexts/RoleContext'
import { useSubscription } from '@/hooks/useSubscription'
import SubscriptionExpired from '@/components/SubscriptionExpired'
import AccessDenied from '@/components/AccessDenied'
import PageHeader from '@/components/ui/PageHeader'
import {
  RiStore2Line,
  RiBankCardLine,
  RiSave3Line,
  RiShieldKeyholeLine,
  RiArrowRightLine,
} from 'react-icons/ri'

const sections = [
  {
    href: '/cilesime/profili',
    icon: RiStore2Line,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    title: 'Profili i Biznesit',
    description: 'Emri i dyqanit, telefoni, adresa dhe numri i NIPT-it',
    allowed: ['owner', 'manager'],
  },
  {
    href: '/cilesime/abonimi',
    icon: RiBankCardLine,
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    title: 'Abonimi & Faturimi',
    description: 'Plani aktual, statusi i trial-it dhe menaxhimi i abonimit',
    allowed: ['owner', 'manager'],
  },
  {
    href: '/cilesime/backup',
    icon: RiSave3Line,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    title: 'Backup & Rikuperim',
    description: 'Eksportoni dhe rikuperoni të dhënat e organizatës',
    allowed: ['owner'],
  },
  {
    href: '/cilesime/siguria',
    icon: RiShieldKeyholeLine,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    title: 'Siguria',
    description: 'Ndryshoni fjalëkalimin dhe shikoni informacionin e sigurisë',
    allowed: ['owner', 'manager'],
  },
]

export default function CilesimiPage() {
  const { role } = useRole()
  const subscription = useSubscription()
  const router = useRouter()

  useEffect(() => {
    if (role !== null && role !== 'owner' && role !== 'manager') {
      router.replace('/')
    }
  }, [role, router])

  if (!role || (role !== 'owner' && role !== 'manager')) return <AccessDenied />
  if (subscription === 'blocked') return <SubscriptionExpired />

  const visibleSections = sections.filter((s) => s.allowed.includes(role))

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
      <PageHeader
        title="Cilësimet"
        subtitle="Menaxho profilin, abonimin, sigurinë dhe kopjet rezervë"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {visibleSections.map((section) => {
          const Icon = section.icon
          return (
            <Link
              key={section.href}
              href={section.href}
              className="card p-5 flex items-start gap-4 hover:border-slate-300 hover:shadow-md transition-all duration-150 group"
            >
              <div className={`w-11 h-11 ${section.iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                <Icon className={`text-xl ${section.iconColor}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 group-hover:text-slate-900">
                  {section.title}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{section.description}</p>
              </div>
              <RiArrowRightLine className="text-slate-300 group-hover:text-slate-500 text-lg flex-shrink-0 mt-0.5 transition-colors" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

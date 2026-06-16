'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useRole } from '@/contexts/RoleContext'
import { useSubscription } from '@/hooks/useSubscription'
import { useNotificationCount } from '@/hooks/useNotificationCount'
import SubscriptionExpired from '@/components/SubscriptionExpired'
import AccessDenied from '@/components/AccessDenied'
import PageHeader from '@/components/ui/PageHeader'
import {
  RiTeamLine,
  RiFingerprint2Line,
  RiBellLine,
  RiFileSearchLine,
  RiArrowRightLine,
} from 'react-icons/ri'

const sections = [
  {
    href: '/perdoruesit',
    icon: RiTeamLine,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    title: 'Përdoruesit',
    description: 'Menaxho llogaritë e përdoruesve dhe rolet e tyre',
    allowed: ['Administrator'],
  },
  {
    href: '/personal',
    icon: RiFingerprint2Line,
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    title: 'Personal PIN',
    description: 'Menaxho stafin lokal dhe kodet PIN të tyre',
    allowed: ['Administrator', 'Manager'],
  },
  {
    href: '/njoftime',
    icon: RiBellLine,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    title: 'Njoftime',
    description: 'Shikoni dhe menaxhoni njoftimet e sistemit',
    allowed: ['Administrator', 'Manager'],
  },
  {
    href: '/regjistri',
    icon: RiFileSearchLine,
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-600',
    title: 'Regjistri Auditimit',
    description: 'Historia e ndryshimeve dhe veprimeve në sistem',
    allowed: ['Administrator'],
  },
]

export default function AdministrimPage() {
  const { role } = useRole()
  const subscription = useSubscription()
  const router = useRouter()
  const notifCount = useNotificationCount(role === 'Administrator' || role === 'Manager')

  useEffect(() => {
    if (role !== null && role !== 'Administrator' && role !== 'Manager') {
      router.replace('/')
    }
  }, [role, router])

  if (!role || (role !== 'Administrator' && role !== 'Manager')) return <AccessDenied />
  if (subscription === 'blocked') return <SubscriptionExpired />

  const visibleSections = sections.filter((s) => s.allowed.includes(role))

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
      <PageHeader
        title="Administrim"
        subtitle="Menaxho përdoruesit, stafin, njoftimet dhe regjistrin e auditimit"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {visibleSections.map((section) => {
          const Icon = section.icon
          return (
            <Link
              key={section.href}
              href={section.href}
              className="card p-5 flex items-start gap-4 hover:border-slate-300 hover:shadow-md transition-all duration-150 group relative"
            >
              <div className={`w-11 h-11 ${section.iconBg} rounded-xl flex items-center justify-center flex-shrink-0 relative`}>
                <Icon className={`text-xl ${section.iconColor}`} />
                {section.href === '/njoftime' && notifCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                    {notifCount > 99 ? '99+' : notifCount}
                  </span>
                )}
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

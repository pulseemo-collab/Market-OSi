'use client'

import { useRole } from '@/contexts/RoleContext'
import { Role } from '@/lib/roles'
import AccessDenied from './AccessDenied'

export default function RoleGuard({
  allowed,
  children,
}: {
  allowed: Role[]
  children: React.ReactNode
}) {
  const { role } = useRole()
  if (!role || !allowed.includes(role)) {
    return <AccessDenied />
  }
  return <>{children}</>
}

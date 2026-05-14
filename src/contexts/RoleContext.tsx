'use client'

import { createContext, useContext } from 'react'
import { Role } from '@/lib/roles'

interface RoleContextValue {
  role: Role | null
}

const RoleContext = createContext<RoleContextValue>({ role: null })

export function RoleProvider({
  role,
  children,
}: {
  role: Role | null
  children: React.ReactNode
}) {
  return <RoleContext.Provider value={{ role }}>{children}</RoleContext.Provider>
}

export function useRole() {
  return useContext(RoleContext)
}

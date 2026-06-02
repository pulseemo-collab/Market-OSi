export type Role = 'owner' | 'manager' | 'cashier' | 'employee'

// Map old DB role strings to new roles for backward compatibility
export const LEGACY_ROLE_MAP: Record<string, Role> = {
  admin: 'owner',
  staff: 'manager',
}

export const PERMISSIONS: Record<string, Role[]> = {
  'products:read':    ['owner', 'manager', 'cashier', 'employee'],
  'products:write':   ['owner', 'manager'],
  'products:delete':  ['owner'],
  'products:prices':  ['owner', 'manager'],

  'suppliers:read':   ['owner', 'manager'],
  'suppliers:write':  ['owner', 'manager'],
  'suppliers:delete': ['owner'],

  'supplies:read':    ['owner', 'manager'],
  'supplies:write':   ['owner', 'manager'],
  'supplies:delete':  ['owner'],

  'sales:read':       ['owner', 'manager', 'cashier'],
  'sales:create':     ['owner', 'cashier'],
  'sales:manage':     ['owner'],

  'dashboard:read':   ['owner', 'manager'],
  'export:read':      ['owner', 'manager'],
  'reorder:read':     ['owner', 'manager'],

  'users:manage':     ['owner'],

  'audit:read':       ['owner'],

  'backup:create':    ['owner'],
  'backup:restore':   ['owner'],
}

export const ROUTE_ACCESS: Record<string, Role[]> = {
  '/':                        ['owner', 'manager'],
  '/produktet':               ['owner', 'manager', 'employee'],
  '/shitjet':                 ['owner', 'cashier'],
  '/historiku':               ['owner', 'manager', 'cashier'],
  '/stok-i-ulet':             ['owner', 'manager'],
  '/porositje-te-sugjeruara': ['owner', 'manager'],
  '/furnizime':               ['owner', 'manager'],
  '/furnitoret':              ['owner', 'manager'],
  '/perdoruesit':             ['owner'],
  '/regjistri':               ['owner'],
  '/backup':                  ['owner'],
}

export const ROLE_LABELS: Record<Role, string> = {
  owner:    'Pronar',
  manager:  'Menaxher',
  cashier:  'Kasijer',
  employee: 'Punonjës',
}

export function hasPermission(role: Role | null, permission: string): boolean {
  if (!role) return false
  const allowed = PERMISSIONS[permission]
  if (!allowed) return false
  return allowed.includes(role)
}

export function canAccess(role: Role | null, path: string): boolean {
  if (!role) return false
  const allowed = ROUTE_ACCESS[path]
  if (!allowed) return true
  return allowed.includes(role)
}

export function isOwner(role: Role | null): boolean {
  return role === 'owner'
}

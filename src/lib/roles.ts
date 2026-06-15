export type Role = 'Administrator' | 'Manager' | 'Cashier' | 'platform_owner'

// Map old/legacy DB role strings to the new canonical names
export const LEGACY_ROLE_MAP: Record<string, Role> = {
  owner:         'Administrator',
  admin:         'Administrator',
  administrator: 'Administrator', // DB may store lowercase; normalize here
  manager:       'Manager',
  staff:         'Manager',
  cashier:       'Cashier',
  employee:      'Cashier',
}

export const PERMISSIONS: Record<string, Role[]> = {
  // Organization business permissions
  'products:read':    ['Administrator', 'Manager', 'Cashier'],
  'products:write':   ['Administrator', 'Manager'],
  'products:delete':  ['Administrator'],
  'products:prices':  ['Administrator', 'Manager'],

  'suppliers:read':   ['Administrator', 'Manager'],
  'suppliers:write':  ['Administrator', 'Manager'],
  'suppliers:delete': ['Administrator'],

  'supplies:read':    ['Administrator', 'Manager'],
  'supplies:write':   ['Administrator', 'Manager'],
  'supplies:delete':  ['Administrator'],

  'sales:read':       ['Administrator', 'Manager', 'Cashier'],
  'sales:create':     ['Administrator', 'Manager', 'Cashier'],
  'sales:manage':     ['Administrator'],

  'dashboard:read':   ['Administrator', 'Manager'],
  'export:read':      ['Administrator', 'Manager'],
  'reorder:read':     ['Administrator', 'Manager'],

  'users:manage':     ['Administrator'],

  'audit:read':       ['Administrator'],

  'backup:create':    ['Administrator'],
  'backup:restore':   ['Administrator'],

  'settings:read':    ['Administrator', 'Manager'],
  'settings:write':   ['Administrator'],

  'notifications:read':   ['Administrator', 'Manager', 'Cashier'],
  'notifications:manage': ['Administrator', 'Manager'],

  // Platform-level permissions (platform_owner only)
  'platform:read':        ['platform_owner'],
  'organizations:read':   ['platform_owner'],
  'organizations:manage': ['platform_owner'],
  'billing:read':         ['platform_owner'],
  'billing:manage':       ['platform_owner'],
  'global:audit':         ['platform_owner'],
  'global:monitoring':    ['platform_owner'],
}

export const ROUTE_ACCESS: Record<string, Role[]> = {
  '/':                        ['Administrator', 'Manager'],
  '/produktet':               ['Administrator', 'Manager'],
  '/shitjet':                 ['Administrator', 'Manager', 'Cashier'],
  '/historiku':               ['Administrator', 'Manager', 'Cashier'],
  '/stok-i-ulet':             ['Administrator', 'Manager'],
  '/porositje-te-sugjeruara': ['Administrator', 'Manager'],
  '/furnizime':               ['Administrator', 'Manager'],
  '/furnitoret':              ['Administrator', 'Manager'],
  '/perdoruesit':             ['Administrator'],
  '/personal':                ['Administrator', 'Manager'],
  '/regjistri':               ['Administrator'],
  '/backup':                  ['Administrator'],
  '/njoftime':               ['Administrator', 'Manager', 'Cashier'],
  '/cilesime':               ['Administrator', 'Manager'],
  '/cilesime/profili':       ['Administrator', 'Manager'],
  '/cilesime/abonimi':       ['Administrator', 'Manager'],
  '/cilesime/backup':        ['Administrator'],
  '/cilesime/siguria':       ['Administrator', 'Manager'],
  '/platforma':              ['platform_owner'],
}

export const ROLE_LABELS: Record<Role, string> = {
  Administrator:  'Pronar',
  Manager:        'Menaxher',
  Cashier:        'Kasijer',
  platform_owner: 'Pronar Platforme',
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
  return role === 'Administrator'
}

export function isPlatformOwner(role: Role | null): boolean {
  return role === 'platform_owner'
}

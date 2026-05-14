export type Role = 'admin' | 'cashier' | 'staff'

export const ROUTE_ACCESS: Record<string, Role[]> = {
  '/': ['admin'],
  '/produktet': ['admin', 'staff'],
  '/shitjet': ['admin', 'cashier'],
  '/historiku': ['admin', 'cashier'],
  '/stok-i-ulet': ['admin', 'staff'],
  '/porositje-te-sugjeruara': ['admin', 'staff'],
  '/furnizime': ['admin', 'staff'],
  '/furnitoret': ['admin', 'staff'],
  '/perdoruesit': ['admin'],
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  cashier: 'Kasijer',
  staff: 'Staf',
}

export function canAccess(role: Role | null, path: string): boolean {
  if (!role) return false
  const allowed = ROUTE_ACCESS[path]
  if (!allowed) return true
  return allowed.includes(role)
}

export function isAdmin(role: Role | null): boolean {
  return role === 'admin'
}

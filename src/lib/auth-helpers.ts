import { createClient } from './supabase/server'
import { prisma } from './prisma'
import { NextResponse } from 'next/server'
import { Role } from './roles'

export async function getAuthUserAndRole(): Promise<{
  userId: string | null
  role: Role | null
  error: NextResponse | null
}> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return {
        userId: null,
        role: null,
        error: NextResponse.json({ error: 'Jo i autentikuar' }, { status: 401 }),
      }
    }

    const userRole = await prisma.userRole.findUnique({ where: { userId: user.id } })
    const role = (userRole?.roli as Role) || 'staff'

    return { userId: user.id, role, error: null }
  } catch {
    return {
      userId: null,
      role: null,
      error: NextResponse.json({ error: 'Gabim në server' }, { status: 500 }),
    }
  }
}

export async function requireRole(allowedRoles: Role[]): Promise<{
  userId: string | null
  role: Role | null
  error: NextResponse | null
}> {
  const result = await getAuthUserAndRole()
  if (result.error) return result

  if (!result.role || !allowedRoles.includes(result.role)) {
    return {
      userId: result.userId,
      role: result.role,
      error: NextResponse.json({ error: 'Nuk ke akses' }, { status: 403 }),
    }
  }

  return result
}

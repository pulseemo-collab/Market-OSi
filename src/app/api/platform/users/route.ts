import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { LEGACY_ROLE_MAP } from '@/lib/roles'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

/**
 * A cross-tenant directory of who exists where — an operational lookup, not a
 * second identity system.
 *
 * Two populations are reported side by side because the product genuinely has
 * two: email accounts backed by Supabase Auth (`UserRole`) and local PIN staff
 * (`Staff`). They are kept in separate arrays rather than merged into one list,
 * because merging would invite treating them as interchangeable, and they are
 * not: only the first can sign in with a password, only the second is confined
 * to a single terminal.
 *
 * `Staff.pinHash` is never selected. Neither population exposes a credential of
 * any kind, and each row states its organization so two same-named users in
 * different tenants stay visibly distinct.
 */
async function handleGet(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('organizations:read')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') ?? '').trim().slice(0, 100)
    const orgParam = searchParams.get('organizationId')
    const kind = searchParams.get('kind') // 'users' | 'staff' | null (both)
    const rawPage = parseInt(searchParams.get('page') ?? '1', 10)
    const rawSize = parseInt(searchParams.get('pageSize') ?? '', 10)

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
    const pageSize =
      Number.isFinite(rawSize) && rawSize > 0 ? Math.min(rawSize, MAX_PAGE_SIZE) : PAGE_SIZE
    const skip = (page - 1) * pageSize

    let orgFilter: number | null = null
    if (orgParam) {
      const parsed = parseInt(orgParam, 10)
      if (isNaN(parsed)) return errorResponse(req, 'ID e pavlefshme', 400)
      orgFilter = parsed
    }

    const like = { contains: q, mode: 'insensitive' as const }

    const userWhere = {
      ...(orgFilter !== null ? { organizationId: orgFilter } : {}),
      ...(q
        ? { OR: [{ email: like }, { organization: { name: like } }] }
        : {}),
    }

    const staffWhere = {
      ...(orgFilter !== null ? { organizationId: orgFilter } : {}),
      ...(q ? { OR: [{ emri: like }, { kodi: like }, { organization: { name: like } }] } : {}),
    }

    const wantUsers = kind !== 'staff'
    const wantStaff = kind !== 'users'

    const [users, usersTotal, staff, staffTotal] = await Promise.all([
      wantUsers
        ? prisma.userRole.findMany({
            where: userWhere,
            orderBy: [{ email: 'asc' }, { id: 'asc' }],
            take: pageSize,
            skip,
            select: {
              id: true,
              userId: true,
              email: true,
              roli: true,
              createdAt: true,
              organizationId: true,
              organization: { select: { name: true, isActive: true } },
            },
          })
        : [],
      wantUsers ? prisma.userRole.count({ where: userWhere }) : 0,
      wantStaff
        ? prisma.staff.findMany({
            where: staffWhere,
            orderBy: [{ emri: 'asc' }, { id: 'asc' }],
            take: pageSize,
            skip,
            select: {
              id: true,
              emri: true,
              kodi: true,
              roli: true,
              isActive: true,
              lockedUntil: true,
              createdAt: true,
              organizationId: true,
              organization: { select: { name: true, isActive: true } },
            },
          })
        : [],
      wantStaff ? prisma.staff.count({ where: staffWhere }) : 0,
    ])

    const now = new Date()

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        userId: u.userId,
        email: u.email,
        roli: LEGACY_ROLE_MAP[u.roli] ?? u.roli,
        createdAt: u.createdAt,
        organizationId: u.organizationId,
        organizationName: u.organization.name,
        organizationActive: u.organization.isActive,
      })),
      usersTotal,
      staff: staff.map((s) => ({
        id: s.id,
        emri: s.emri,
        kodi: s.kodi,
        roli: s.roli,
        isActive: s.isActive,
        isLocked: !!(s.lockedUntil && s.lockedUntil > now),
        createdAt: s.createdAt,
        organizationId: s.organizationId,
        organizationName: s.organization.name,
        organizationActive: s.organization.isActive,
      })),
      staffTotal,
      page,
      pageSize,
    })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/users', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/platform/users', handleGet)

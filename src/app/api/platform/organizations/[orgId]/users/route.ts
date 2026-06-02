import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { LEGACY_ROLE_MAP } from '@/lib/roles'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const { userId, organizationId, error } = await requirePermission('organizations:read')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return NextResponse.json({ error: 'ID e pavlefshme' }, { status: 400 })
  }

  try {
    const users = await prisma.userRole.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, userId: true, email: true, roli: true, createdAt: true },
    })

    const mapped = users.map((u) => ({
      ...u,
      roli: (LEGACY_ROLE_MAP[u.roli] ?? u.roli) as string,
    }))

    return NextResponse.json({ users: mapped })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations/[orgId]/users', action: 'GET' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

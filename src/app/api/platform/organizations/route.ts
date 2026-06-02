import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('organizations:manage')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const body = await req.json()
    const name = (body.name ?? '').trim()
    if (!name) {
      return NextResponse.json({ error: 'Emri është i detyrueshëm' }, { status: 400 })
    }

    const org = await prisma.organization.create({
      data: { name },
    })

    return NextResponse.json({ organization: org }, { status: 201 })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations', action: 'POST' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

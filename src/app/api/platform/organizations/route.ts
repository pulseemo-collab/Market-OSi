import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { PLATFORM_TAG, invalidateTags } from '@/lib/cache'
import { withIdempotency } from '@/lib/idempotency'

export const dynamic = 'force-dynamic'

async function handlePost(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('organizations:manage')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  // A double submit here would create a second organization with its own trial.
  return withIdempotency(
    req,
    { route: 'POST /api/platform/organizations', organizationId: organizationId ?? 0, userId: userId! },
    () => createOrganization(req),
  )
}

async function createOrganization(req: NextRequest) {
  try {
    const body = await req.json()
    const name = (body.name ?? '').trim()
    if (!name) {
      return errorResponse(req, 'Emri është i detyrueshëm', 400)
    }

    const org = await prisma.organization.create({
      data: {
        name,
        subscription: {
          create: {
            plan: 'trial',
            status: 'trialing',
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        },
      },
    })

    invalidateTags(PLATFORM_TAG)

    return NextResponse.json({ organization: org }, { status: 201 })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations', action: 'POST' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const POST = instrumentRoute('/api/platform/organizations', handlePost)

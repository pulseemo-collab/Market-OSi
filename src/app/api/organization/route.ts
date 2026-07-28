import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { CACHE_TTL, cached, invalidateTags, orgTag } from '@/lib/cache'

async function handleGet() {
  const { organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  try {
    const org = await cached(
      {
        namespace: 'organization',
        organizationId: organizationId!,
        variant: 'contact',
        ttlMs: CACHE_TTL.organization,
        tags: [orgTag(organizationId!, 'organization')],
      },
      () =>
        prisma.organization.findUnique({
          where: { id: organizationId! },
          select: { name: true, telefoni: true },
        }),
    )
    if (!org) return errorResponse('Organizata nuk u gjet', 404)
    return NextResponse.json(org)
  } catch {
    return errorResponse('Gabim në server', 500)
  }
}

async function handlePatch(req: NextRequest) {
  const { organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  const rl = rateLimit(req, 'platform', null, organizationId)
  if (rl.limited) return rl.response!

  try {
    const { telefoni } = await req.json()
    if (!telefoni?.trim()) {
      return errorResponse(req, 'Numri i telefonit është i detyrueshëm', 400)
    }
    const phone = telefoni.trim().replace(/[\s\-]/g, '')
    if (!/^(\+355\d{9}|0\d{9})$/.test(phone)) {
      return errorResponse(req, 'Numri i telefonit nuk është valid', 400)
    }
    const org = await prisma.organization.update({
      where: { id: organizationId! },
      data: { telefoni: phone },
      select: { name: true, telefoni: true },
    })

    invalidateTags(orgTag(organizationId!, 'organization'))

    return NextResponse.json(org)
  } catch {
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/organization', handleGet)
export const PATCH = instrumentRoute('/api/organization', handlePatch)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { CACHE_TTL, cached, invalidateTags, orgTag } from '@/lib/cache'

export const dynamic = 'force-dynamic'

async function handleGet() {
  const { organizationId, error } = await requirePermission('settings:read')
  if (error) return error

  const org = await cached(
    {
      namespace: 'organization',
      organizationId: organizationId!,
      variant: 'profile',
      ttlMs: CACHE_TTL.organization,
      tags: [orgTag(organizationId!, 'organization')],
    },
    () =>
      prisma.organization.findUnique({
        where: { id: organizationId! },
        select: { id: true, name: true, telefoni: true, adresa: true, nipt: true },
      }),
  )

  if (!org) return errorResponse('Organizata nuk u gjet', 404)

  return NextResponse.json(org)
}

async function handlePatch(request: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('settings:write')
  if (error) return error

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return errorResponse(request, 'Të dhëna të pavlefshme', 400)
  }

  const { name, telefoni, adresa, nipt } = body as Record<string, unknown>

  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    return errorResponse(request, 'Emri i biznesit është i detyrueshëm', 400)
  }

  const data: Record<string, string | null> = {}
  if (name !== undefined) data.name = (name as string).trim()
  if (telefoni !== undefined) data.telefoni = telefoni ? String(telefoni).trim() : null
  if (adresa !== undefined) data.adresa = adresa ? String(adresa).trim() : null
  if (nipt !== undefined) data.nipt = nipt ? String(nipt).trim() : null

  const updated = await prisma.organization.update({
    where: { id: organizationId! },
    data,
    select: { id: true, name: true, telefoni: true, adresa: true, nipt: true },
  })

  invalidateTags(orgTag(organizationId!, 'organization'))

  await logAuditAction({
    userId: userId!,
    userEmail: userEmail!,
    userRole: role!,
    organizationId: organizationId!,
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'organization',
    entityId: organizationId,
    description: 'U përditësua profili i biznesit',
    metadata: { fields: Object.keys(data) },
  })

  return NextResponse.json(updated)
}

export const GET = instrumentRoute('/api/organizations/profile', handleGet)
export const PATCH = instrumentRoute('/api/organizations/profile', handlePatch)

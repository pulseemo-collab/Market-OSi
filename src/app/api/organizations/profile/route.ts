import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { organizationId, error } = await requirePermission('settings:read')
  if (error) return error

  const org = await prisma.organization.findUnique({
    where: { id: organizationId! },
    select: { id: true, name: true, telefoni: true, adresa: true, nipt: true },
  })

  if (!org) return NextResponse.json({ error: 'Organizata nuk u gjet' }, { status: 404 })

  return NextResponse.json(org)
}

export async function PATCH(request: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('settings:write')
  if (error) return error

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Të dhëna të pavlefshme' }, { status: 400 })
  }

  const { name, telefoni, adresa, nipt } = body as Record<string, unknown>

  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    return NextResponse.json({ error: 'Emri i biznesit është i detyrueshëm' }, { status: 400 })
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

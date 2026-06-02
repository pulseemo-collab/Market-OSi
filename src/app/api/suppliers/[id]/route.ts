import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, buildFieldChanges, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('suppliers:write')
  if (error) return error

  const rl = rateLimit(req, 'suppliers', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const existing = await prisma.supplier.findFirst({
      where: { id: Number(params.id), organizationId: organizationId! },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Furnitori nuk u gjet' }, { status: 404 })
    }

    const body = await req.json()
    const { emri, telefoni, email: supplierEmail, adresa, shenime } = body

    const changes = buildFieldChanges([
      { label: 'Emri', old: existing.emri, new: emri },
      { label: 'Telefoni', old: existing.telefoni, new: telefoni },
      { label: 'Email', old: existing.email, new: supplierEmail },
      { label: 'Adresa', old: existing.adresa, new: adresa },
      { label: 'Shënime', old: existing.shenime, new: shenime },
    ])

    const supplier = await prisma.supplier.update({
      where: { id: Number(params.id) },
      data: { emri, telefoni, email: supplierEmail, adresa, shenime },
      include: { products: { select: { id: true, emri: true } } },
    })

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.UPDATE,
      entityType: AUDIT_ENTITY_TYPES.SUPPLIER,
      entityId: supplier.id,
      description: `Furnitori "${supplier.emri}" u modifikua`,
      metadata: { changes },
    })

    return NextResponse.json(supplier)
  } catch (error) {
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/suppliers/[id]', action: 'PUT' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('suppliers:delete')
  if (error) return error

  const rl = rateLimit(req, 'suppliers', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const existing = await prisma.supplier.findFirst({
      where: { id: Number(params.id), organizationId: organizationId! },
      select: { id: true, emri: true },
    })

    const result = await prisma.supplier.deleteMany({
      where: { id: Number(params.id), organizationId: organizationId! },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Furnitori nuk u gjet' }, { status: 404 })
    }

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.DELETE,
      entityType: AUDIT_ENTITY_TYPES.SUPPLIER,
      entityId: params.id,
      description: `Furnitori "${existing?.emri ?? `#${params.id}`}" u fshi`,
    })

    return NextResponse.json({ sukses: true })
  } catch (error) {
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/suppliers/[id]', action: 'DELETE' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

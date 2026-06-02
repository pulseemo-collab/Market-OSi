import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'

export async function GET() {
  const { organizationId, error } = await requirePermission('suppliers:read')
  if (error) return error

  try {
    const suppliers = await prisma.supplier.findMany({
      where: { organizationId: organizationId! },
      include: {
        products: {
          select: { id: true, emri: true },
        },
      },
      orderBy: { emri: 'asc' },
    })
    return NextResponse.json(suppliers)
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/suppliers', action: 'GET' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('suppliers:write')
  if (error) return error

  try {
    const body = await req.json()
    const { emri, telefoni, email: supplierEmail, adresa, shenime } = body

    if (!emri) {
      return NextResponse.json(
        { error: 'Emri i furnitorit është i detyrueshëm' },
        { status: 400 }
      )
    }

    const supplier = await prisma.supplier.create({
      data: { emri, telefoni, email: supplierEmail, adresa, shenime, organizationId: organizationId! },
      include: { products: { select: { id: true, emri: true } } },
    })

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.CREATE,
      entityType: AUDIT_ENTITY_TYPES.SUPPLIER,
      entityId: supplier.id,
      description: `Furnitori "${supplier.emri}" u krijua`,
      metadata: { telefoni: supplier.telefoni, email: supplier.email },
    })

    return NextResponse.json(supplier, { status: 201 })
  } catch (error) {
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/suppliers', action: 'POST' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

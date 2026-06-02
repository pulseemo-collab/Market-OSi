import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { organizationId, error } = await requirePermission('supplies:read')
  if (error) return error

  try {
    const id = parseInt(params.id)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
    }

    const supply = await prisma.supply.findFirst({
      where: { id, organizationId: organizationId! },
      include: {
        furnitor: { select: { id: true, emri: true } },
        items: {
          include: {
            product: { select: { id: true, emri: true, njesia: true } },
          },
        },
      },
    })

    if (!supply) {
      return NextResponse.json({ error: 'Furnizimi nuk u gjet' }, { status: 404 })
    }

    return NextResponse.json(supply)
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/supplies/[id]', action: 'GET' })
    console.error('Supply GET error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('supplies:delete')
  if (error) return error

  try {
    const id = parseInt(params.id)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
    }

    let supplySnapshot: { id: number; totali: number; numriItems: number } | null = null

    await prisma.$transaction(async (tx) => {
      const supply = await tx.supply.findFirst({
        where: { id, organizationId: organizationId! },
        include: { items: true },
      })

      if (!supply) throw new Error('NOT_FOUND')

      supplySnapshot = { id: supply.id, totali: supply.totali, numriItems: supply.items.length }

      for (const item of supply.items) {
        await tx.product.updateMany({
          where: { id: item.productId, organizationId: organizationId! },
          data: { sasia: { decrement: item.sasia } },
        })
      }

      await tx.supply.delete({ where: { id } })
    })

    if (supplySnapshot) {
      await logAuditAction({
        userId: userId!,
        userEmail: userEmail!,
        userRole: role!,
        organizationId: organizationId!,
        action: AUDIT_ACTIONS.DELETE,
        entityType: AUDIT_ENTITY_TYPES.SUPPLY,
        entityId: id,
        description: `Furnizimi #${id} u fshi (totali: ${(supplySnapshot as { totali: number }).totali.toFixed(2)} L)`,
        metadata: { totali: (supplySnapshot as { totali: number }).totali },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Furnizimi nuk u gjet' }, { status: 404 })
    }
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/supplies/[id]', action: 'DELETE' })
    console.error('Supply DELETE error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

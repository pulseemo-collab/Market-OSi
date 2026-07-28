import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { invalidateTags, orgTag } from '@/lib/cache'

type RouteContext = { params: { id: string } }

async function handleGet(req: NextRequest, { params }: RouteContext) {
  const { userId, role, organizationId, error } = await requirePermission('supplies:read')
  if (error) return error

  const rl = rateLimit(req, 'supplies', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  try {
    const id = parseInt(params.id)
    if (isNaN(id)) {
      return errorResponse(req, 'ID i pavlefshëm', 400)
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
      return errorResponse(req, 'Furnizimi nuk u gjet', 404)
    }

    return NextResponse.json(supply)
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/supplies/[id]', action: 'GET' })
    console.error('Supply GET error:', error)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handleDelete(req: NextRequest, { params }: RouteContext) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('supplies:delete')
  if (error) return error

  const rl = rateLimit(req, 'supplies', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  try {
    const id = parseInt(params.id)
    if (isNaN(id)) {
      return errorResponse(req, 'ID i pavlefshëm', 400)
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

    invalidateTags(orgTag(organizationId!, 'supplies'), orgTag(organizationId!, 'products'))

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
      return errorResponse(req, 'Furnizimi nuk u gjet', 404)
    }
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/supplies/[id]', action: 'DELETE' })
    console.error('Supply DELETE error:', error)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute<RouteContext>('/api/supplies/[id]', handleGet)
export const DELETE = instrumentRoute<RouteContext>('/api/supplies/[id]', handleDelete)

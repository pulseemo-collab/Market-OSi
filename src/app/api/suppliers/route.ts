import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { CACHE_TTL, cached, invalidateTags, orgTag } from '@/lib/cache'
import { withIdempotency } from '@/lib/idempotency'

async function handleGet(req: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('suppliers:read')
  if (error) return error

  const rl = rateLimit(req, 'suppliers', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  try {
    // Three pages load this list purely to populate a supplier select, and it
    // changes only when a supplier or a product's supplier link is edited.
    const suppliers = await cached(
      {
        namespace: 'suppliers',
        organizationId: organizationId!,
        ttlMs: CACHE_TTL.suppliers,
        tags: [orgTag(organizationId!, 'suppliers'), orgTag(organizationId!, 'products')],
      },
      () =>
        prisma.supplier.findMany({
          where: { organizationId: organizationId! },
          include: {
            products: {
              select: { id: true, emri: true },
            },
          },
          orderBy: [{ emri: 'asc' }, { id: 'asc' }],
        }),
    )
    return NextResponse.json(suppliers)
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/suppliers', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handlePost(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('suppliers:write')
  if (error) return error

  const rl = rateLimit(req, 'suppliers', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  return withIdempotency(
    req,
    { route: 'POST /api/suppliers', organizationId: organizationId!, userId: userId! },
    () => createSupplier(req, userId!, userEmail!, role!, organizationId!),
  )
}

async function createSupplier(
  req: NextRequest,
  userId: string,
  userEmail: string,
  role: string,
  organizationId: number,
) {
  try {
    const body = await req.json()
    const { emri, telefoni, email: supplierEmail, adresa, shenime } = body

    if (!emri) {
      return errorResponse(req, 'Emri i furnitorit është i detyrueshëm', 400)
    }

    const supplier = await prisma.supplier.create({
      data: { emri, telefoni, email: supplierEmail, adresa, shenime, organizationId },
      include: { products: { select: { id: true, emri: true } } },
    })

    invalidateTags(orgTag(organizationId, 'suppliers'))

    await logAuditAction({
      userId,
      userEmail,
      userRole: role,
      organizationId,
      action: AUDIT_ACTIONS.CREATE,
      entityType: AUDIT_ENTITY_TYPES.SUPPLIER,
      entityId: supplier.id,
      description: `Furnitori "${supplier.emri}" u krijua`,
      metadata: { telefoni: supplier.telefoni, email: supplier.email },
    })

    return NextResponse.json(supplier, { status: 201 })
  } catch (error) {
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/suppliers', action: 'POST' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/suppliers', handleGet)
export const POST = instrumentRoute('/api/suppliers', handlePost)

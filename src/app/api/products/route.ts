import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'
import { resolveStaffAuth } from '@/lib/staff-auth'
import type { Role } from '@/lib/roles'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { invalidateTags, orgTag } from '@/lib/cache'
import { withIdempotency } from '@/lib/idempotency'
import { DEFAULT_SAFETY_LIMIT, paginationHeaders, parsePageRequest } from '@/lib/pagination'

async function handleGet(req: NextRequest) {
  // Dual auth: Supabase session or staff PIN session
  const supabase = await requirePermission('products:read')
  let userId: string | null
  let role: Role | null
  let organizationId: number | null

  if (!supabase.error) {
    userId = supabase.userId
    role = supabase.role
    organizationId = supabase.organizationId
  } else {
    const staff = await resolveStaffAuth(req, ['Cashier'])
    if (staff.error) return staff.error
    userId = staff.userId
    role = staff.staffRole as Role
    organizationId = staff.organizationId
  }

  const rl = rateLimit(req, 'products', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  try {
    const { searchParams } = new URL(req.url)
    const kerkimi = searchParams.get('kerkimi') || ''
    const kategoria = searchParams.get('kategoria') || ''
    const stokUlet = searchParams.get('stokUlet') === 'true'
    const arkivuar = searchParams.get('arkivuar') || 'active'

    const archivedWhere =
      arkivuar === 'archived'
        ? { isArchived: true }
        : arkivuar === 'all'
          ? {}
          : { isArchived: false }

    const where = {
      organizationId: organizationId!,
      ...archivedWhere,
      AND: [
        kerkimi
          ? {
              OR: [
                { emri: { contains: kerkimi, mode: 'insensitive' as const } },
                { kategoria: { contains: kerkimi, mode: 'insensitive' as const } },
                { barcodes: { some: { barcode: { contains: kerkimi } } } },
              ],
            }
          : {},
        kategoria ? { kategoria } : {},
      ],
    }

    const page = parsePageRequest(searchParams)

    // "Low stock" compares two columns, which Prisma cannot express in a filter,
    // so those rows are selected in Node. Paging therefore happens after the
    // filter for that view, and in the database for every other view. Either
    // way the read stays bounded by the safety limit.
    if (stokUlet) {
      const products = await prisma.product.findMany({
        where,
        include: { furnitor: true, barcodes: true },
        orderBy: [{ emri: 'asc' }, { id: 'asc' }],
        take: DEFAULT_SAFETY_LIMIT,
      })
      const lowStock = products.filter((p) => p.sasia <= p.stokuMinimal)

      if (!page.explicit) return NextResponse.json(lowStock)

      return NextResponse.json(lowStock.slice(page.skip, page.skip + page.take), {
        headers: paginationHeaders(page, lowStock.length),
      })
    }

    if (!page.explicit) {
      const products = await prisma.product.findMany({
        where,
        include: { furnitor: true, barcodes: true },
        orderBy: [{ emri: 'asc' }, { id: 'asc' }],
        take: page.take,
      })
      return NextResponse.json(products)
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { furnitor: true, barcodes: true },
        orderBy: [{ emri: 'asc' }, { id: 'asc' }],
        take: page.take,
        skip: page.skip,
      }),
      prisma.product.count({ where }),
    ])

    return NextResponse.json(products, { headers: paginationHeaders(page, total) })
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/products', action: 'GET' })
    console.error('Products GET error:', error)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handlePost(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('products:write')
  if (error) return error

  const rl = rateLimit(req, 'products', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return errorResponse(req, 'Abonimi ka skaduar', 403)

  return withIdempotency(
    req,
    { route: 'POST /api/products', organizationId: organizationId!, userId: userId! },
    () => createProduct(req, userId!, userEmail!, role!, organizationId!),
  )
}

async function createProduct(
  req: NextRequest,
  userId: string,
  userEmail: string,
  role: Role,
  organizationId: number,
) {
  try {
    const body = await req.json()
    const {
      emri,
      barcodes,
      kategoria,
      sasia,
      stokuMinimal,
      cmimiBlerjes,
      cmimiShitjes,
      njesia,
      furnitorId,
    } = body

    if (!emri || !kategoria || cmimiBlerjes == null || cmimiShitjes == null) {
      return errorResponse(req, 'Fushat e detyrueshme mungojnë', 400)
    }

    const validBarcodes: string[] = Array.isArray(barcodes)
      ? (barcodes as string[]).map((b) => b.trim()).filter(Boolean)
      : []

    if (validBarcodes.length > 10) {
      return errorResponse(req, 'Maksimumi 10 barkode për produkt', 400)
    }

    const product = await prisma.product.create({
      data: {
        emri,
        kategoria,
        sasia: Number(sasia) || 0,
        stokuMinimal: Number(stokuMinimal) || 5,
        cmimiBlerjes: Number(cmimiBlerjes),
        cmimiShitjes: Number(cmimiShitjes),
        njesia: njesia || 'copë',
        furnitorId: furnitorId ? Number(furnitorId) : null,
        organizationId,
        barcodes: {
          create: validBarcodes.map((barcode) => ({ barcode })),
        },
      },
      include: { furnitor: true, barcodes: true },
    })

    invalidateTags(orgTag(organizationId, 'products'))

    await logAuditAction({
      userId,
      userEmail,
      userRole: role,
      organizationId,
      action: AUDIT_ACTIONS.CREATE,
      entityType: AUDIT_ENTITY_TYPES.PRODUCT,
      entityId: product.id,
      description: `Produkti "${product.emri}" u krijua (${product.kategoria})`,
      metadata: { kategoria: product.kategoria, cmimiShitjes: product.cmimiShitjes },
    })

    return NextResponse.json(product, { status: 201 })
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      return errorResponse(req, 'Barkodi ekziston tashmë', 409)
    }
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/products', action: 'POST' })
    console.error('Products POST error:', error)
    return errorResponse(req, 'Gabim në server', 500)
  }
}

export const GET = instrumentRoute('/api/products', handleGet)
export const POST = instrumentRoute('/api/products', handlePost)

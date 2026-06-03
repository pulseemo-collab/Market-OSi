import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { logAuditAction, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'

export async function GET(req: NextRequest) {
  const { userId, role, organizationId, error } = await requirePermission('products:read')
  if (error) return error

  const rl = rateLimit(req, 'products', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

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

    const products = await prisma.product.findMany({
      where: {
        organizationId: organizationId!,
        ...archivedWhere,
        AND: [
          kerkimi
            ? {
                OR: [
                  { emri: { contains: kerkimi, mode: 'insensitive' } },
                  { kategoria: { contains: kerkimi, mode: 'insensitive' } },
                  { barcodes: { some: { barcode: { contains: kerkimi } } } },
                ],
              }
            : {},
          kategoria ? { kategoria } : {},
        ],
      },
      include: { furnitor: true, barcodes: true },
      orderBy: { emri: 'asc' },
    })

    const filtered = stokUlet
      ? products.filter((p) => p.sasia <= p.stokuMinimal)
      : products

    return NextResponse.json(filtered)
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/products', action: 'GET' })
    console.error('Products GET error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('products:write')
  if (error) return error

  const rl = rateLimit(req, 'products', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

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
      return NextResponse.json(
        { error: 'Fushat e detyrueshme mungojnë' },
        { status: 400 }
      )
    }

    const validBarcodes: string[] = Array.isArray(barcodes)
      ? (barcodes as string[]).map((b) => b.trim()).filter(Boolean)
      : []

    if (validBarcodes.length > 10) {
      return NextResponse.json(
        { error: 'Maksimumi 10 barkode për produkt' },
        { status: 400 }
      )
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
        organizationId: organizationId!,
        barcodes: {
          create: validBarcodes.map((barcode) => ({ barcode })),
        },
      },
      include: { furnitor: true, barcodes: true },
    })

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
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
      return NextResponse.json(
        { error: 'Barkodi ekziston tashmë' },
        { status: 409 }
      )
    }
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/products', action: 'POST' })
    console.error('Products POST error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

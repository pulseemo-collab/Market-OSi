import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { hasPermission } from '@/lib/roles'
import { logAuditAction, buildFieldChanges, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@/lib/audit'
import { captureApiError } from '@/lib/sentry'
import { rateLimit } from '@/lib/rate-limit'
import { checkSubscriptionAccess } from '@/lib/billing-enforcement'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, role, organizationId, error } = await requirePermission('products:read')
  if (error) return error

  const rl = rateLimit(req, 'products', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

  try {
    const product = await prisma.product.findFirst({
      where: { id: Number(params.id), organizationId: organizationId! },
      include: { furnitor: true, barcodes: true },
    })
    if (!product) {
      return NextResponse.json({ error: 'Produkti nuk u gjet' }, { status: 404 })
    }
    return NextResponse.json(product)
  } catch (error) {
    captureApiError(error, { organizationId, route: '/api/products/[id]', action: 'GET' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, userEmail, role, organizationId, error: authError } = await requirePermission('products:write')
  if (authError) return authError

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

    const validBarcodes: string[] = Array.isArray(barcodes)
      ? (barcodes as string[]).map((b) => b.trim()).filter(Boolean)
      : []

    if (validBarcodes.length > 10) {
      return NextResponse.json(
        { error: 'Maksimumi 10 barkode për produkt' },
        { status: 400 }
      )
    }

    const existing = await prisma.product.findFirst({
      where: { id: Number(params.id), organizationId: organizationId! },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Produkti nuk u gjet' }, { status: 404 })
    }

    const canEditPrices = hasPermission(role, 'products:prices')

    const newSasia = Number(sasia)
    const newStokuMinimal = Number(stokuMinimal)
    const newCmimiBlerjes = canEditPrices ? Number(cmimiBlerjes) : Number(existing.cmimiBlerjes)
    const newCmimiShitjes = canEditPrices ? Number(cmimiShitjes) : Number(existing.cmimiShitjes)

    const changes = buildFieldChanges([
      { label: 'Emri', old: existing.emri, new: emri },
      { label: 'Kategoria', old: existing.kategoria, new: kategoria },
      { label: 'Stoku', old: existing.sasia, new: newSasia },
      { label: 'Stoku minimal', old: existing.stokuMinimal, new: newStokuMinimal },
      { label: 'Njësia', old: existing.njesia, new: njesia || 'copë' },
      ...(canEditPrices ? [
        { label: 'Çmimi blerjes', old: Number(existing.cmimiBlerjes), new: newCmimiBlerjes },
        { label: 'Çmimi shitjes', old: Number(existing.cmimiShitjes), new: newCmimiShitjes },
      ] : []),
    ])

    const product = await prisma.product.update({
      where: { id: Number(params.id) },
      data: {
        emri,
        kategoria,
        sasia: Number(sasia),
        stokuMinimal: Number(stokuMinimal),
        cmimiBlerjes: canEditPrices ? Number(cmimiBlerjes) : existing.cmimiBlerjes,
        cmimiShitjes: canEditPrices ? Number(cmimiShitjes) : existing.cmimiShitjes,
        njesia: njesia || 'copë',
        furnitorId: furnitorId ? Number(furnitorId) : null,
        barcodes: {
          deleteMany: {},
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
      action: AUDIT_ACTIONS.UPDATE,
      entityType: AUDIT_ENTITY_TYPES.PRODUCT,
      entityId: product.id,
      description: `Produkti "${product.emri}" u modifikua`,
      metadata: { changes },
    })

    return NextResponse.json(product)
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
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/products/[id]', action: 'PUT' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, userEmail, role, organizationId, error } = await requirePermission('products:delete')
  if (error) return error

  const rl = rateLimit(req, 'products', userId, organizationId)
  if (rl.limited) return rl.response!

  const billing = await checkSubscriptionAccess(organizationId!, role!)
  if (!billing.allowed) return NextResponse.json({ error: 'Abonimi ka skaduar' }, { status: 403 })

  try {
    const existing = await prisma.product.findFirst({
      where: { id: Number(params.id), organizationId: organizationId! },
      select: { id: true, emri: true, kategoria: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Produkti nuk u gjet' }, { status: 404 })
    }

    const hasSales = (await prisma.saleItem.count({ where: { productId: existing.id } })) > 0

    if (hasSales) {
      await prisma.product.update({
        where: { id: existing.id },
        data: { isArchived: true, archivedAt: new Date() },
      })

      await logAuditAction({
        userId: userId!,
        userEmail: userEmail!,
        userRole: role!,
        organizationId: organizationId!,
        action: AUDIT_ACTIONS.ARCHIVE,
        entityType: AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: params.id,
        description: `Produkti "${existing.emri}" u arkivua (ka histori shitjesh)`,
        metadata: { kategoria: existing.kategoria },
      })

      return NextResponse.json({ sukses: true, arkivuar: true })
    }

    await prisma.product.delete({ where: { id: existing.id } })

    await logAuditAction({
      userId: userId!,
      userEmail: userEmail!,
      userRole: role!,
      organizationId: organizationId!,
      action: AUDIT_ACTIONS.DELETE,
      entityType: AUDIT_ENTITY_TYPES.PRODUCT,
      entityId: params.id,
      description: `Produkti "${existing.emri}" u fshi`,
      metadata: { kategoria: existing.kategoria },
    })

    return NextResponse.json({ sukses: true, arkivuar: false })
  } catch (error) {
    captureApiError(error, { userId, userEmail, role, organizationId, route: '/api/products/[id]', action: 'DELETE' })
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

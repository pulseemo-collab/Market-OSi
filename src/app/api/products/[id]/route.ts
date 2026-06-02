import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { hasPermission } from '@/lib/roles'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requirePermission('products:read')
  if (error) return error

  try {
    const product = await prisma.product.findUnique({
      where: { id: Number(params.id) },
      include: { furnitor: true, barcodes: true },
    })
    if (!product) {
      return NextResponse.json({ error: 'Produkti nuk u gjet' }, { status: 404 })
    }
    return NextResponse.json(product)
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { role, error: authError } = await requirePermission('products:write')
  if (authError) return authError

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

    const existing = await prisma.product.findUnique({ where: { id: Number(params.id) } })
    if (!existing) {
      return NextResponse.json({ error: 'Produkti nuk u gjet' }, { status: 404 })
    }

    const canEditPrices = hasPermission(role, 'products:prices')

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
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requirePermission('products:delete')
  if (error) return error

  try {
    await prisma.product.delete({
      where: { id: Number(params.id) },
    })
    return NextResponse.json({ sukses: true })
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

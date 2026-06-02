import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { organizationId, error } = await requirePermission('suppliers:write')
  if (error) return error

  try {
    const existing = await prisma.supplier.findFirst({
      where: { id: Number(params.id), organizationId: organizationId! },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Furnitori nuk u gjet' }, { status: 404 })
    }

    const body = await req.json()
    const { emri, telefoni, email, adresa, shenime } = body

    const supplier = await prisma.supplier.update({
      where: { id: Number(params.id) },
      data: { emri, telefoni, email, adresa, shenime },
      include: { products: { select: { id: true, emri: true } } },
    })

    return NextResponse.json(supplier)
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { organizationId, error } = await requirePermission('suppliers:delete')
  if (error) return error

  try {
    const result = await prisma.supplier.deleteMany({
      where: { id: Number(params.id), organizationId: organizationId! },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Furnitori nuk u gjet' }, { status: 404 })
    }
    return NextResponse.json({ sukses: true })
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

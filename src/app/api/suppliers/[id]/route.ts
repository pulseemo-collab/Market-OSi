import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requirePermission('suppliers:write')
  if (error) return error

  try {
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
  const { error } = await requirePermission('suppliers:delete')
  if (error) return error

  try {
    await prisma.supplier.delete({ where: { id: Number(params.id) } })
    return NextResponse.json({ sukses: true })
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

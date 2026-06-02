import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'

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
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { organizationId, error } = await requirePermission('suppliers:write')
  if (error) return error

  try {
    const body = await req.json()
    const { emri, telefoni, email, adresa, shenime } = body

    if (!emri) {
      return NextResponse.json(
        { error: 'Emri i furnitorit është i detyrueshëm' },
        { status: 400 }
      )
    }

    const supplier = await prisma.supplier.create({
      data: { emri, telefoni, email, adresa, shenime, organizationId: organizationId! },
      include: { products: { select: { id: true, emri: true } } },
    })

    return NextResponse.json(supplier, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

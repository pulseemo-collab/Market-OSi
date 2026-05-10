import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const suppliers = await prisma.supplier.findMany({
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
      data: { emri, telefoni, email, adresa, shenime },
      include: { products: { select: { id: true, emri: true } } },
    })

    return NextResponse.json(supplier, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

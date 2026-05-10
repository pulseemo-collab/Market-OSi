import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const kerkimi = searchParams.get('kerkimi') || ''
    const kategoria = searchParams.get('kategoria') || ''
    const stokUlet = searchParams.get('stokUlet') === 'true'

    const products = await prisma.product.findMany({
      where: {
        AND: [
          kerkimi
            ? {
                OR: [
                  { emri: { contains: kerkimi } },
                  { barcode: { contains: kerkimi } },
                  { kategoria: { contains: kerkimi } },
                ],
              }
            : {},
          kategoria ? { kategoria } : {},
        ],
      },
      include: { furnitor: true },
      orderBy: { emri: 'asc' },
    })

    const filtered = stokUlet
      ? products.filter((p) => p.sasia <= p.stokuMinimal)
      : products

    return NextResponse.json(filtered)
  } catch (error) {
    console.error('Products GET error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      emri,
      barcode,
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

    const product = await prisma.product.create({
      data: {
        emri,
        barcode: barcode || null,
        kategoria,
        sasia: Number(sasia) || 0,
        stokuMinimal: Number(stokuMinimal) || 5,
        cmimiBlerjes: Number(cmimiBlerjes),
        cmimiShitjes: Number(cmimiShitjes),
        njesia: njesia || 'copë',
        furnitorId: furnitorId ? Number(furnitorId) : null,
      },
      include: { furnitor: true },
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
    console.error('Products POST error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const saleId = parseInt(params.id)

    if (isNaN(saleId)) {
      return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
    }

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    })

    if (!sale) {
      return NextResponse.json({ error: 'Fatura nuk u gjet' }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { sasia: { increment: item.sasia } },
        })
      }

      await tx.sale.delete({ where: { id: saleId } })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Sale DELETE error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requirePermission('supplies:read')
  if (error) return error

  try {
    const id = parseInt(params.id)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
    }

    const supply = await prisma.supply.findUnique({
      where: { id },
      include: {
        furnitor: { select: { id: true, emri: true } },
        items: {
          include: {
            product: { select: { id: true, emri: true, njesia: true } },
          },
        },
      },
    })

    if (!supply) {
      return NextResponse.json({ error: 'Furnizimi nuk u gjet' }, { status: 404 })
    }

    return NextResponse.json(supply)
  } catch (error) {
    console.error('Supply GET error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error } = await requirePermission('supplies:delete')
  if (error) return error

  try {
    const id = parseInt(params.id)
    if (isNaN(id)) {
      return NextResponse.json({ error: 'ID i pavlefshëm' }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      const supply = await tx.supply.findUnique({
        where: { id },
        include: { items: true },
      })

      if (!supply) throw new Error('NOT_FOUND')

      for (const item of supply.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { sasia: { decrement: item.sasia } },
        })
      }

      await tx.supply.delete({ where: { id } })
    })

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Furnizimi nuk u gjet' }, { status: 404 })
    }
    console.error('Supply DELETE error:', error)
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

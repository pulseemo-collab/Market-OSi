import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const periudha = searchParams.get('periudha') || 'sot'
    const ngaParam = searchParams.get('nga')
    const deriParam = searchParams.get('deri')

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    let periodStart: Date
    let periodEnd: Date = tomorrowStart
    let periudhaLabel: string

    switch (periudha) {
      case 'dje': {
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
        periodStart = yesterday
        periodEnd = todayStart
        periudhaLabel = 'Dje'
        break
      }
      case 'jave':
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
        periudhaLabel = 'Kjo Jave'
        break
      case 'muaj':
        periodStart = monthStart
        periudhaLabel = 'Ky Muaj'
        break
      case 'custom':
        periodStart = ngaParam ? new Date(ngaParam) : monthStart
        if (deriParam) {
          const d = new Date(deriParam)
          d.setHours(23, 59, 59, 999)
          periodEnd = d
        }
        periudhaLabel = 'Periudhe e Zgjedhur'
        break
      default:
        periodStart = todayStart
        periudhaLabel = 'Sot'
    }

    const [shitjet, produktet, furnizimet] = await Promise.all([
      prisma.sale.findMany({
        where: { createdAt: { gte: periodStart, lt: periodEnd } },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.findMany({
        include: { furnitor: { select: { emri: true } } },
        orderBy: { emri: 'asc' },
      }),
      prisma.supply.findMany({
        include: {
          furnitor: { select: { emri: true } },
          items: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ])

    const stokUlet = produktet.filter((p) => p.sasia <= p.stokuMinimal)
    const totali = shitjet.reduce((s, x) => s + x.totali, 0)
    const fitimi = shitjet.reduce((s, x) => s + x.fitimi, 0)

    return NextResponse.json({
      periudhaLabel,
      nga: ngaParam || null,
      deri: deriParam || null,
      summary: {
        totali,
        fitimi,
        numriShitjeve: shitjet.length,
        marzhi: totali > 0 ? (fitimi / totali) * 100 : 0,
      },
      shitjet,
      produktet,
      stokUlet,
      furnizimet,
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Gabim ne server' }, { status: 500 })
  }
}

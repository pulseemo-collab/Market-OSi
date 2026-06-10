import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'

export async function GET() {
  const { organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId! },
      select: { name: true, telefoni: true },
    })
    if (!org) return NextResponse.json({ error: 'Organizata nuk u gjet' }, { status: 404 })
    return NextResponse.json(org)
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const { organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  try {
    const { telefoni } = await req.json()
    if (!telefoni?.trim()) {
      return NextResponse.json({ error: 'Numri i telefonit është i detyrueshëm' }, { status: 400 })
    }
    const phone = telefoni.trim().replace(/[\s\-]/g, '')
    if (!/^(\+355\d{9}|0\d{9})$/.test(phone)) {
      return NextResponse.json({ error: 'Numri i telefonit nuk është valid' }, { status: 400 })
    }
    const org = await prisma.organization.update({
      where: { id: organizationId! },
      data: { telefoni: phone },
      select: { name: true, telefoni: true },
    })
    return NextResponse.json(org)
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

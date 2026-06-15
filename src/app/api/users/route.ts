import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'

const VALID_ROLES = ['Administrator', 'Manager', 'Cashier'] as const

export async function GET(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  const rl = rateLimit(req, 'auth', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const users = await prisma.userRole.findMany({
      where: { organizationId: organizationId! },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(users)
  } catch {
    return NextResponse.json({ error: 'Gabim në server' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  const rl = rateLimit(req, 'auth', userId, organizationId)
  if (rl.limited) return rl.response!

  let body: { email?: unknown; roli?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body i pavlefshëm' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  const roli  = typeof body.roli  === 'string' ? body.roli.trim() : ''

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email i pavlefshëm' }, { status: 400 })
  }
  if (!VALID_ROLES.includes(roli as (typeof VALID_ROLES)[number])) {
    return NextResponse.json({ error: 'Roli i pavlefshëm' }, { status: 400 })
  }

  // Duplicate checks before touching Supabase
  const existingInOrg = await prisma.userRole.findFirst({
    where: { email, organizationId: organizationId! },
  })
  if (existingInOrg) {
    return NextResponse.json({ error: 'Ky email ekziston tashmë në organizatë' }, { status: 409 })
  }

  const existingElsewhere = await prisma.userRole.findFirst({ where: { email } })
  if (existingElsewhere) {
    return NextResponse.json(
      { error: 'Ky email është i caktuar në një organizatë tjetër' },
      { status: 409 }
    )
  }

  let supabaseUserId: string
  let inviteMethod: string

  try {
    const admin = createAdminClient()

    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/login/manager`,
    })

    if (!inviteError && inviteData.user?.id) {
      supabaseUserId = inviteData.user.id
      inviteMethod  = 'invite'
    } else {
      const alreadyExists =
        inviteError?.message?.toLowerCase().includes('already') ||
        inviteError?.message?.toLowerCase().includes('registered')

      if (!alreadyExists) {
        return NextResponse.json(
          { error: `Gabim gjatë ftesës: ${inviteError?.message ?? 'E panjohur'}` },
          { status: 500 }
        )
      }

      // Find existing Supabase user by email
      let foundId: string | null = null
      let page = 1
      while (true) {
        const { data: listData } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (!listData?.users?.length) break
        const match = listData.users.find((u) => u.email?.toLowerCase() === email)
        if (match?.id) { foundId = match.id; break }
        if (listData.users.length < 1000) break
        page++
      }

      if (!foundId) {
        return NextResponse.json({ error: 'Përdoruesi nuk u gjet në sistem' }, { status: 500 })
      }
      supabaseUserId = foundId
      inviteMethod   = 'existing'
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('SERVICE_ROLE_KEY')) {
      return NextResponse.json(
        { error: 'Email-i nuk mund të dërgohet — SUPABASE_SERVICE_ROLE_KEY nuk është konfiguruar.' },
        { status: 501 }
      )
    }
    return NextResponse.json({ error: 'Gabim gjatë krijimit të përdoruesit' }, { status: 500 })
  }

  // Guard against userId already assigned to any org
  const existingByUserId = await prisma.userRole.findUnique({ where: { userId: supabaseUserId } })
  if (existingByUserId) {
    return NextResponse.json(
      { error: 'Ky përdorues është tashmë i caktuar në një organizatë' },
      { status: 409 }
    )
  }

  try {
    const userRole = await prisma.userRole.create({
      data: { userId: supabaseUserId, email, roli, organizationId: organizationId! },
    })

    const messages: Record<string, string> = {
      invite:   'Ftesa u dërgua me email',
      existing: 'Përdoruesi ekzistues u shtua në organizatë',
    }

    return NextResponse.json(
      { success: true, userRole, inviteMethod, message: messages[inviteMethod] ?? 'U shtua' },
      { status: 201 }
    )
  } catch {
    return NextResponse.json({ error: 'Gabim gjatë ruajtjes' }, { status: 500 })
  }
}

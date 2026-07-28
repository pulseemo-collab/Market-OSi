import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { errorResponse, instrumentRoute } from '@/lib/logger'
import { paginationHeaders, parsePageRequest } from '@/lib/pagination'
import { withIdempotency } from '@/lib/idempotency'

const VALID_ROLES = ['Administrator', 'Manager', 'Cashier'] as const

async function handleGet(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  const rl = rateLimit(req, 'auth', userId, organizationId)
  if (rl.limited) return rl.response!

  try {
    const { searchParams } = new URL(req.url)
    const where = { organizationId: organizationId! }
    const page = parsePageRequest(searchParams)

    const query = {
      where,
      orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      take: page.take,
    }

    if (!page.explicit) {
      return NextResponse.json(await prisma.userRole.findMany(query))
    }

    const [users, total] = await Promise.all([
      prisma.userRole.findMany({ ...query, skip: page.skip }),
      prisma.userRole.count({ where }),
    ])

    return NextResponse.json(users, { headers: paginationHeaders(page, total) })
  } catch {
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handlePost(req: NextRequest) {
  const { userId, organizationId, error } = await requirePermission('users:manage')
  if (error) return error

  const rl = rateLimit(req, 'auth', userId, organizationId)
  if (rl.limited) return rl.response!

  // Inviting a user sends an email and creates a Supabase account. A duplicate
  // submit must not do either a second time.
  return withIdempotency(
    req,
    { route: 'POST /api/users', organizationId: organizationId!, userId: userId! },
    () => inviteUser(req, organizationId!),
  )
}

async function inviteUser(req: NextRequest, organizationId: number) {
  let body: { email?: unknown; roli?: unknown }
  try {
    body = await req.json()
  } catch {
    return errorResponse(req, 'Body i pavlefshëm', 400)
  }

  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  const roli  = typeof body.roli  === 'string' ? body.roli.trim() : ''

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse(req, 'Email i pavlefshëm', 400)
  }
  if (!VALID_ROLES.includes(roli as (typeof VALID_ROLES)[number])) {
    return errorResponse(req, 'Roli i pavlefshëm', 400)
  }

  // Duplicate checks before touching Supabase
  const existingInOrg = await prisma.userRole.findFirst({
    where: { email, organizationId },
  })
  if (existingInOrg) {
    return errorResponse(req, 'Ky email ekziston tashmë në organizatë', 409)
  }

  const existingElsewhere = await prisma.userRole.findFirst({ where: { email } })
  if (existingElsewhere) {
    return errorResponse(req, 'Ky email është i caktuar në një organizatë tjetër', 409)
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
        return errorResponse(req, `Gabim gjatë ftesës: ${inviteError?.message ?? 'E panjohur'}`, 500)
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
        return errorResponse(req, 'Përdoruesi nuk u gjet në sistem', 500)
      }
      supabaseUserId = foundId
      inviteMethod   = 'existing'
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('SERVICE_ROLE_KEY')) {
      return errorResponse(req, 'Email-i nuk mund të dërgohet — SUPABASE_SERVICE_ROLE_KEY nuk është konfiguruar.', 501)
    }
    return errorResponse(req, 'Gabim gjatë krijimit të përdoruesit', 500)
  }

  // Guard against userId already assigned to any org
  const existingByUserId = await prisma.userRole.findUnique({ where: { userId: supabaseUserId } })
  if (existingByUserId) {
    return errorResponse(req, 'Ky përdorues është tashmë i caktuar në një organizatë', 409)
  }

  try {
    const userRole = await prisma.userRole.create({
      data: { userId: supabaseUserId, email, roli, organizationId },
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
    return errorResponse(req, 'Gabim gjatë ruajtjes', 500)
  }
}

export const GET = instrumentRoute('/api/users', handleGet)
export const POST = instrumentRoute('/api/users', handlePost)

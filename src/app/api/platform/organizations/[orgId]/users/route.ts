import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { captureApiError } from '@/lib/sentry'
import { LEGACY_ROLE_MAP } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { errorResponse, instrumentRoute } from '@/lib/logger'

type RouteContext = { params: { orgId: string } }

export const dynamic = 'force-dynamic'

const VALID_ROLES = ['Administrator', 'Manager', 'Cashier'] as const

async function authUserExists(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.auth.admin.getUserById(userId)
    return !!data.user
  } catch {
    return true // fail-safe: assume exists when we can't verify
  }
}

async function resolveSupabaseUser(email: string): Promise<{ userId: string; method: string }> {
  const admin = createAdminClient()

  // Try invite first — creates the user if they don't exist and sends an email link
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/login`,
  })

  if (!inviteError && inviteData.user?.id) {
    return { userId: inviteData.user.id, method: 'invite' }
  }

  // User already exists in Supabase — find them by searching the user list
  const alreadyExists =
    inviteError?.message?.toLowerCase().includes('already') ||
    inviteError?.message?.toLowerCase().includes('registered')

  if (alreadyExists) {
    let page = 1
    const PER_PAGE = 1000
    while (true) {
      const { data: listData, error: listError } = await admin.auth.admin.listUsers({
        page,
        perPage: PER_PAGE,
      })
      if (listError || !listData?.users) break

      const match = listData.users.find((u) => u.email?.toLowerCase() === email)
      if (match?.id) return { userId: match.id, method: 'existing' }
      if (listData.users.length < PER_PAGE) break
      page++
    }
    throw new Error(`Përdoruesi me email ${email} nuk u gjet në Supabase Auth.`)
  }

  // Fallback: create user directly with a random temporary password
  const tempPassword =
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10).toUpperCase() +
    '!1'

  const { data: createData, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  })

  if (createError || !createData.user?.id) {
    throw new Error(createError?.message ?? 'Nuk mund të krijohet përdoruesi në Supabase.')
  }

  return { userId: createData.user.id, method: 'created' }
}

async function handleGet(req: NextRequest, { params }: RouteContext) {
  const { userId, organizationId, error } = await requirePermission('organizations:read')
  if (error) return error

  const rl = rateLimit(req, 'platform', userId, organizationId)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
  }

  try {
    const users = await prisma.userRole.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, userId: true, email: true, roli: true, createdAt: true },
    })

    const mapped = users.map((u) => ({
      ...u,
      roli: (LEGACY_ROLE_MAP[u.roli] ?? u.roli) as string,
    }))

    return NextResponse.json({ users: mapped })
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations/[orgId]/users', action: 'GET' })
    return errorResponse(req, 'Gabim në server', 500)
  }
}

async function handlePost(req: NextRequest, { params }: RouteContext) {
  const { userId: callerUserId, error } = await requirePermission('organizations:manage')
  if (error) return error

  const rl = rateLimit(req, 'platform', callerUserId, null)
  if (rl.limited) return rl.response!

  const orgId = parseInt(params.orgId, 10)
  if (isNaN(orgId)) {
    return errorResponse(req, 'ID e pavlefshme', 400)
  }

  let body: { email?: unknown; roli?: unknown }
  try {
    body = await req.json()
  } catch {
    return errorResponse(req, 'Body i pavlefshëm', 400)
  }

  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  const roli = typeof body.roli === 'string' ? body.roli : ''

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse(req, 'Email i pavlefshëm', 400)
  }
  if (!VALID_ROLES.includes(roli as (typeof VALID_ROLES)[number])) {
    return errorResponse(req, 'Roli i pavlefshëm', 400)
  }

  // Verify org exists
  const org = await prisma.organization.findUnique({ where: { id: orgId } })
  if (!org) {
    return errorResponse(req, 'Organizata nuk u gjet', 404)
  }

  // Block duplicate email within this org (unless the auth user was deleted — orphaned record)
  const existingInOrg = await prisma.userRole.findFirst({
    where: { email, organizationId: orgId },
  })
  if (existingInOrg) {
    const stillExists = await authUserExists(existingInOrg.userId)
    if (stillExists) {
      return errorResponse(req, 'Ky email ekziston tashmë në këtë organizatë', 409)
    }
    // Orphaned record — auth user no longer exists, clean up and proceed
    await prisma.userRole.delete({ where: { id: existingInOrg.id } })
  }

  // Block email already assigned to any other org (unless orphaned)
  const existingElsewhere = await prisma.userRole.findFirst({ where: { email } })
  if (existingElsewhere) {
    const stillExists = await authUserExists(existingElsewhere.userId)
    if (stillExists) {
      return errorResponse(req, 'Ky email është tashmë i caktuar në një organizatë tjetër', 409)
    }
    // Orphaned record — auth user no longer exists, clean up and proceed
    await prisma.userRole.delete({ where: { id: existingElsewhere.id } })
  }

  // Resolve Supabase user ID
  let supabaseUserId: string
  let method: string
  try {
    const result = await resolveSupabaseUser(email)
    supabaseUserId = result.userId
    method = result.method
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gabim i panjohur'
    if (msg.includes('SERVICE_ROLE_KEY')) {
      return NextResponse.json(
        {
          error: 'SUPABASE_SERVICE_ROLE_KEY nuk është konfiguruar.',
          fallback: 'Shikoni ORGANIZATION_USER_INVITES.md për udhëzime manuale.',
        },
        { status: 501 }
      )
    }
    captureApiError(err, { route: '/api/platform/organizations/[orgId]/users', action: 'POST' })
    return errorResponse(req, `Gabim Supabase: ${msg}`, 500)
  }

  // Guard against userId collision (shouldn't happen but be safe)
  const existingByUserId = await prisma.userRole.findUnique({
    where: { userId: supabaseUserId },
  })
  if (existingByUserId) {
    return errorResponse(req, 'Ky përdorues është tashmë i caktuar në një organizatë', 409)
  }

  try {
    const userRole = await prisma.userRole.create({
      data: { userId: supabaseUserId, email, roli, organizationId: orgId },
    })

    const messages: Record<string, string> = {
      invite: 'Ftesa u dërgua me email',
      existing: 'Përdoruesi ekzistues u shtua në organizatë',
      created: 'Llogaria u krijua (fjalëkalim i përkohshëm — njoftoni përdoruesin)',
    }

    return NextResponse.json(
      { success: true, userRole, inviteMethod: method, message: messages[method] ?? 'U shtua' },
      { status: 201 }
    )
  } catch (err) {
    captureApiError(err, { route: '/api/platform/organizations/[orgId]/users', action: 'POST' })
    return errorResponse(req, 'Gabim gjatë ruajtjes në bazën e të dhënave', 500)
  }
}

export const GET = instrumentRoute<RouteContext>('/api/platform/organizations/[orgId]/users', handleGet)
export const POST = instrumentRoute<RouteContext>('/api/platform/organizations/[orgId]/users', handlePost)

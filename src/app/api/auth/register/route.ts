import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { errorResponse, instrumentRoute } from '@/lib/logger'

async function handlePost(req: NextRequest) {
  const rl = rateLimit(req, 'register', null, null)
  if (rl.limited) return rl.response!

  const admin = createAdminClient()
  let authUserId: string | null = null

  try {
    const { dyqani, emri, telefoni, email, password, plan } = await req.json()

    if (!dyqani?.trim() || !emri?.trim() || !telefoni?.trim() || !email?.trim() || !password) {
      return errorResponse(req, 'Të gjitha fushat janë të detyrueshme', 400)
    }
    if (password.length < 6) {
      return errorResponse(req, 'Fjalëkalimi duhet të ketë të paktën 6 karaktere', 400)
    }
    const phone = telefoni.trim().replace(/[\s\-]/g, '')
    if (!/^(\+355\d{9}|0\d{9})$/.test(phone)) {
      return errorResponse(req, 'Numri i telefonit nuk është valid', 400)
    }
    const selectedPlan = plan === 'yearly' ? 'yearly' : 'monthly'

    // Step 1: Create Supabase Auth user
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name: emri.trim() },
    })

    if (authError) {
      const msg = authError.message.toLowerCase()
      if (msg.includes('already') || msg.includes('registered') || msg.includes('duplicate')) {
        return errorResponse(req, 'Ky email është tashmë i regjistruar', 409)
      }
      return errorResponse(req, authError.message, 400)
    }

    authUserId = authData.user.id

    // Step 2: Create Organization
    let orgId: number
    try {
      const org = await prisma.organization.create({
        data: { name: dyqani.trim(), telefoni: phone },
        select: { id: true },
      })
      orgId = org.id
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[register] STEP 2 organization create failed:', msg, err)
      await admin.auth.admin.deleteUser(authUserId).catch((e) =>
        console.error('[register] Auth rollback failed:', e)
      )
      return errorResponse(req, 'Gabim gjatë krijimit të organizatës. Provo sërish.', 500)
    }

    // Step 3: Create UserRole
    try {
      await prisma.userRole.create({
        data: {
          userId: authUserId,
          email: email.trim(),
          roli: 'Administrator',
          organizationId: orgId,
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[register] STEP 3 userRole create failed:', msg, err)
      await Promise.allSettled([
        admin.auth.admin.deleteUser(authUserId),
        prisma.organization.delete({ where: { id: orgId } }),
      ])
      return errorResponse(req, 'Gabim gjatë krijimit të llogarisë. Provo sërish.', 500)
    }

    // Step 4: Create Subscription
    try {
      await prisma.subscription.create({
        data: {
          organizationId: orgId,
          plan: selectedPlan,
          status: 'trialing',
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[register] STEP 4 subscription create failed:', msg, err)
      await prisma.userRole.deleteMany({ where: { organizationId: orgId } }).catch(() => null)
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => null)
      await admin.auth.admin.deleteUser(authUserId).catch((e) =>
        console.error('[register] Auth rollback failed:', e)
      )
      return errorResponse(req, 'Gabim gjatë aktivizimit të provës. Provo sërish.', 500)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[register] UNEXPECTED ERROR:', msg, err)
    if (authUserId) {
      await admin.auth.admin.deleteUser(authUserId).catch((e) =>
        console.error('[register] Auth rollback failed:', e)
      )
    }
    return errorResponse(req, 'Gabim i brendshëm i serverit', 500)
  }
}

export const POST = instrumentRoute('/api/auth/register', handlePost)

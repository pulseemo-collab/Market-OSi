import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const { dyqani, emri, telefoni, email, password } = await req.json()

    if (!dyqani?.trim() || !emri?.trim() || !telefoni?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ error: 'Të gjitha fushat janë të detyrueshme' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Fjalëkalimi duhet të ketë të paktën 6 karaktere' }, { status: 400 })
    }
    const phone = telefoni.trim().replace(/[\s\-]/g, '')
    if (!/^(\+355\d{9}|0\d{9})$/.test(phone)) {
      return NextResponse.json({ error: 'Numri i telefonit nuk është valid' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name: emri.trim() },
    })

    if (authError) {
      const msg = authError.message.toLowerCase()
      if (msg.includes('already') || msg.includes('registered') || msg.includes('duplicate')) {
        return NextResponse.json({ error: 'Ky email është tashmë i regjistruar' }, { status: 409 })
      }
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const userId = authData.user.id

    await prisma.organization.create({
      data: {
        name: dyqani.trim(),
        telefoni: phone,
        subscription: {
          create: {
            plan: 'trial',
            status: 'trialing',
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        },
        userRoles: {
          create: {
            userId,
            email: email.trim(),
            roli: 'owner',
          },
        },
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[register]', err)
    return NextResponse.json({ error: 'Gabim i brendshëm i serverit' }, { status: 500 })
  }
}

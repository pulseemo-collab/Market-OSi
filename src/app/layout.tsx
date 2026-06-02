import type { Metadata, Viewport } from 'next'
import './globals.css'
import ClientLayout from '@/components/layout/ClientLayout'
import { Toaster } from 'react-hot-toast'
import MetaMaskErrorFilter from '@/components/MetaMaskErrorFilter'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { Role, LEGACY_ROLE_MAP } from '@/lib/roles'
import { setUserContext } from '@/lib/sentry'

export const metadata: Metadata = {
  title: 'Market OS',
  description: 'Sistem i menaxhimit të marketit',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let role: Role | null = null

  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      let userRole = await prisma.userRole.findUnique({ where: { userId: user.id } })
      if (!userRole) {
        const count = await prisma.userRole.count()
        const defaultRole = count === 0 ? 'owner' : 'employee'
        let org = await prisma.organization.findFirst({ orderBy: { id: 'asc' } })
        if (!org) {
          org = await prisma.organization.create({
            data: {
              name: 'Default Market',
              subscription: {
                create: {
                  plan: 'free',
                  status: 'trial',
                  trialStartsAt: new Date(),
                  trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
              },
            },
          })
        }
        userRole = await prisma.userRole.create({
          data: { userId: user.id, email: user.email || '', roli: defaultRole, organizationId: org.id },
        })
      }
      const rawRole = userRole.roli
      role = (LEGACY_ROLE_MAP[rawRole] ?? rawRole) as Role
      setUserContext({
        userId: user.id,
        userEmail: userRole.email,
        role,
        organizationId: userRole.organizationId,
      })
    }
  } catch {
    // If DB is unavailable, proceed without role (middleware still protects routes)
  }

  return (
    <html lang="sq">
      <body>
        <ClientLayout role={role}>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </ClientLayout>
        <MetaMaskErrorFilter />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              background: '#1e293b',
              color: '#f8fafc',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: '500',
            },
            success: {
              iconTheme: { primary: '#22c55e', secondary: '#f8fafc' },
            },
            error: {
              iconTheme: { primary: '#ef4444', secondary: '#f8fafc' },
            },
          }}
        />
      </body>
    </html>
  )
}

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
  let orgName: string | null = null

  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      const userRole = await prisma.userRole.findUnique({
        where: { userId: user.id },
        include: { organization: { select: { name: true } } },
      })
      if (userRole) {
        const rawRole = userRole.roli
        role = (LEGACY_ROLE_MAP[rawRole] ?? rawRole) as Role
        orgName = userRole.organization?.name ?? null
        setUserContext({
          userId: user.id,
          userEmail: userRole.email,
          role,
          organizationId: userRole.organizationId,
        })
      }
    }
  } catch {
    // If DB is unavailable, proceed without role (middleware still protects routes)
  }

  return (
    <html lang="sq">
      <body>
        <ClientLayout role={role} orgName={orgName}>
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

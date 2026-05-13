import type { Metadata, Viewport } from 'next'
import './globals.css'
import ClientLayout from '@/components/layout/ClientLayout'
import { Toaster } from 'react-hot-toast'
import MetaMaskErrorFilter from '@/components/MetaMaskErrorFilter'

export const metadata: Metadata = {
  title: 'Market OS',
  description: 'Sistem i menaxhimit të marketit',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="sq">
      <body>
        <ClientLayout>
          {children}
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

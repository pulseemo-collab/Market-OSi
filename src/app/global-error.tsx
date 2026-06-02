'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="sq">
      <body>
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-slate-400">
          <p className="text-base">Ndodhi një gabim i papritur.</p>
          <button
            onClick={reset}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            Provo sërish
          </button>
        </div>
      </body>
    </html>
  )
}

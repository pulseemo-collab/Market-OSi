'use client'

import { useEffect } from 'react'

const IGNORED_PATTERNS = [
  'MetaMask',
  'chrome-extension',
  'Failed to connect to MetaMask',
]

function isExtensionError(message: string): boolean {
  return IGNORED_PATTERNS.some((p) => message.includes(p))
}

export default function MetaMaskErrorFilter() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const msg = event.message ?? ''
      const src = event.filename ?? ''
      if (isExtensionError(msg) || isExtensionError(src)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const msg =
        typeof reason === 'string'
          ? reason
          : reason instanceof Error
          ? reason.message
          : String(reason ?? '')
      if (isExtensionError(msg)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }

    window.addEventListener('error', handleError, true)
    window.addEventListener('unhandledrejection', handleUnhandledRejection, true)

    return () => {
      window.removeEventListener('error', handleError, true)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection, true)
    }
  }, [])

  return null
}

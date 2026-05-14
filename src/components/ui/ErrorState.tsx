'use client'

import { RiErrorWarningLine, RiRefreshLine } from 'react-icons/ri'

interface ErrorStateProps {
  message?: string
  onRetry?: () => void
}

export default function ErrorState({
  message = 'Gabim gjatë ngarkimit',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="p-10 text-center">
      <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
        <RiErrorWarningLine className="text-red-500 text-2xl" />
      </div>
      <p className="text-slate-700 font-medium mb-1">{message}</p>
      <p className="text-sm text-slate-400 mb-4">Kontrolloni lidhjen dhe provoni sërish</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary inline-flex items-center gap-2">
          <RiRefreshLine />
          Provo Sërish
        </button>
      )}
    </div>
  )
}

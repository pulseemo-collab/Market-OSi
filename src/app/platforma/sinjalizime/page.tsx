'use client'

/**
 * Platform Owner — attention queue.
 *
 * Every row is derived on read from organization state (see lib/platform-alerts).
 * Nothing is stored and nothing is acknowledged: fixing the underlying condition
 * makes the alert disappear, which is the only acknowledgement that cannot go
 * stale.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import PlatformShell from '@/components/platform/PlatformShell'
import { SeverityBadge } from '@/components/platform/StateBadge'
import ErrorState from '@/components/ui/ErrorState'
import type { AlertSeverity, PlatformAlert } from '@/lib/platform-alerts'
import { ALERT_SEVERITY_LABELS } from '@/lib/platform-alerts'
import { RiAlarmWarningLine, RiRefreshLine, RiCheckboxCircleLine, RiArrowRightSLine } from 'react-icons/ri'

export default function PlatformAlertsPage() {
  const [alerts, setAlerts] = useState<PlatformAlert[]>([])
  const [counts, setCounts] = useState<Record<AlertSeverity, number>>({ high: 0, medium: 0, low: 0 })
  const [severity, setSeverity] = useState<AlertSeverity | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const qs = severity === 'all' ? '' : `?severity=${severity}`
      const res = await fetch(`/api/platform/alerts${qs}`)
      if (res.status === 401) throw new Error('Sesioni ka skaduar. Hyr sërish.')
      if (res.status === 403) throw new Error('Nuk ke akses te sinjalizimet e platformës.')
      if (!res.ok) throw new Error('Sinjalizimet nuk u ngarkuan dot. Provo sërish.')
      const body = await res.json()
      setAlerts(body.alerts ?? [])
      setCounts(body.counts ?? { high: 0, medium: 0, low: 0 })
    } catch (e) {
      setAlerts([])
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [severity])

  useEffect(() => { load() }, [load])

  const total = counts.high + counts.medium + counts.low

  return (
    <PlatformShell
      title="Sinjalizime"
      subtitle={
        total === 0
          ? 'Asgjë nuk kërkon vëmendje tani'
          : `${total} çështje · ${counts.high} urgjente`
      }
      action={
        <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
          <RiRefreshLine className={loading ? 'animate-spin' : ''} /> Rifresko
        </button>
      }
    >
      <div className="flex flex-wrap gap-1.5 mb-5">
        <button
          onClick={() => setSeverity('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            severity === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Të gjitha {total}
        </button>
        {(['high', 'medium', 'low'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSeverity(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              severity === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {ALERT_SEVERITY_LABELS[s]} {counts[s]}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading && alerts.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : alerts.length === 0 ? (
          <div className="p-12 text-center">
            {total === 0 ? (
              <>
                <RiCheckboxCircleLine className="text-4xl text-green-200 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">Gjithçka në rregull</p>
                <p className="text-sm text-slate-400 mt-1">
                  Asnjë organizatë nuk kërkon vëmendje operative për momentin.
                </p>
              </>
            ) : (
              <>
                <RiAlarmWarningLine className="text-4xl text-slate-200 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">Asnjë sinjalizim në këtë nivel</p>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {alerts.map((a) => (
              <Link
                key={`${a.organizationId}-${a.kind}`}
                href={`/platforma/organizatat/${a.organizationId}`}
                className="flex items-start gap-3 p-4 hover:bg-slate-50 transition-colors"
              >
                <div className="flex-shrink-0 pt-0.5">
                  <SeverityBadge severity={a.severity} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">{a.organizationName}</p>
                  <p className="text-sm text-slate-600">{a.title}</p>
                  <p className="text-xs text-slate-400 break-words">{a.detail}</p>
                </div>
                <RiArrowRightSLine className="text-slate-300 flex-shrink-0 mt-1" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </PlatformShell>
  )
}

'use client'

/**
 * Platform Owner — system health.
 *
 * A reading of the health endpoint that already exists, not a new metrics
 * pipeline. `/api/health?metrics=true` gates its performance counters behind
 * `global:monitoring`, so this page shows an operator exactly what that endpoint
 * is willing to publish and nothing more.
 *
 * Deliberately absent: environment variable values, database URLs, tokens and
 * stack traces. The endpoint reports configuration as "configured" /
 * "misconfigured" and classifies database failures into a code — this page just
 * renders those, and must never be extended to display raw values.
 */

import { useCallback, useEffect, useState } from 'react'
import PlatformShell from '@/components/platform/PlatformShell'
import ErrorState from '@/components/ui/ErrorState'
import {
  RiPulseLine, RiRefreshLine, RiDatabase2Line, RiShieldCheckLine,
  RiSpeedLine, RiStackLine, RiCheckboxCircleFill, RiErrorWarningFill, RiAlertFill,
} from 'react-icons/ri'

interface Health {
  status: 'ok' | 'degraded' | 'unavailable'
  ready: boolean
  timestamp: string
  version: string
  uptimeSeconds: number
  services: {
    api: string
    database: { status: 'ok' | 'degraded' | 'error'; latencyMs: number | null; failure?: string }
    supabase: { status: string }
    authService: { status: string }
  }
  metrics?: {
    uptimeSeconds: number
    counters: Record<string, number>
    durations: Record<string, { count: number; avgMs: number; maxMs: number; slowCount: number }>
    cache: { hits: number; misses: number; hitRate: number | null }
    cacheStore: { entries: number; tags: number; maxEntries: number }
    dedupeInFlight: number
    idempotency: Record<string, unknown>
    jobs: Record<string, unknown>
    circuits: Record<string, unknown>
    concurrency: Record<string, unknown>
  }
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
    ok:            { label: 'Në rregull',   color: 'bg-green-100 text-green-700',  Icon: RiCheckboxCircleFill },
    configured:    { label: 'I konfiguruar', color: 'bg-green-100 text-green-700',  Icon: RiCheckboxCircleFill },
    degraded:      { label: 'I ngadaltë',   color: 'bg-amber-100 text-amber-700',  Icon: RiAlertFill },
    error:         { label: 'Gabim',        color: 'bg-red-100 text-red-700',      Icon: RiErrorWarningFill },
    misconfigured: { label: 'Mungon konfigurimi', color: 'bg-red-100 text-red-700', Icon: RiErrorWarningFill },
    unavailable:   { label: 'Jashtë funksionit', color: 'bg-red-100 text-red-700', Icon: RiErrorWarningFill },
  }
  const info = map[status] ?? { label: status, color: 'bg-slate-100 text-slate-600', Icon: RiAlertFill }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${info.color}`}>
      <info.Icon className="text-xs" />
      {info.label}
    </span>
  )
}

function Card({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-800 text-right">{value}</span>
    </div>
  )
}

export default function SystemHealthPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // A 503 here is a real answer (the instance is not ready), not a transport
      // failure — parse it rather than treating it as an error state.
      const res = await fetch('/api/health?metrics=true')
      if (res.status === 401) throw new Error('Sesioni ka skaduar. Hyr sërish.')
      if (res.status === 403) throw new Error('Nuk ke akses te metrikat e sistemit.')
      if (!res.ok && res.status !== 503) throw new Error('Gjendja e sistemit nuk u lexua dot.')
      setHealth(await res.json())
      setCheckedAt(new Date())
    } catch (e) {
      setHealth(null)
      setLoadError(e instanceof Error ? e.message : 'Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const m = health?.metrics

  // Slowest endpoints by average, from the counters the app already records.
  const slowest = m
    ? Object.entries(m.durations)
        .filter(([key]) => key.startsWith('endpoint.'))
        .sort((a, b) => b[1].avgMs - a[1].avgMs)
        .slice(0, 8)
    : []

  const errorCounters = m
    ? Object.entries(m.counters)
        .filter(([key]) => key.startsWith('error.') || key.includes('5xx') || key.startsWith('dependency.failure'))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
    : []

  return (
    <PlatformShell
      title="Sistemi"
      subtitle={
        checkedAt
          ? `Kontrolluar ${checkedAt.toLocaleTimeString('sq-AL')}`
          : 'Gjendja operative e aplikacionit'
      }
      action={
        <button onClick={load} disabled={loading} className="btn-secondary flex items-center gap-2">
          <RiRefreshLine className={loading ? 'animate-spin' : ''} /> Kontrollo sërish
        </button>
      }
    >
      {loading && !health ? (
        <div className="py-16 text-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : loadError ? (
        <div className="card"><ErrorState message={loadError} onRetry={load} /></div>
      ) : !health ? null : (
        <div className="space-y-5">
          {/* Overall */}
          <div className={`rounded-xl border p-4 ${
            health.status === 'ok'
              ? 'border-green-200 bg-green-50'
              : health.ready ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'
          }`}>
            <div className="flex flex-wrap items-center gap-3">
              <RiPulseLine className={`text-2xl ${
                health.status === 'ok' ? 'text-green-600' : health.ready ? 'text-amber-600' : 'text-red-600'
              }`} />
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {health.status === 'ok'
                    ? 'Sistemi funksionon normalisht'
                    : health.ready
                      ? 'Sistemi funksionon, por është i ngadaltë'
                      : 'Sistemi nuk është gati të pranojë kërkesa'}
                </p>
                <p className="text-xs text-slate-500">
                  Versioni {health.version} · aktiv prej {formatUptime(health.uptimeSeconds)}
                </p>
              </div>
              <div className="ml-auto"><StatusPill status={health.status} /></div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card title="Shërbimet" icon={RiShieldCheckLine}>
              <Line label="API" value={<StatusPill status={health.services.api} />} />
              <Line
                label="Baza e të dhënave"
                value={
                  <span className="inline-flex items-center gap-2">
                    <StatusPill status={health.services.database.status} />
                    {health.services.database.latencyMs !== null && (
                      <span className="text-xs text-slate-500">{health.services.database.latencyMs} ms</span>
                    )}
                  </span>
                }
              />
              {health.services.database.failure && (
                <Line label="Lloji i gabimit" value={<span className="text-xs font-mono text-red-600">{health.services.database.failure}</span>} />
              )}
              <Line label="Supabase" value={<StatusPill status={health.services.supabase.status} />} />
              <Line label="Shërbimi i llogarive" value={<StatusPill status={health.services.authService.status} />} />
              <p className="text-xs text-slate-400 mt-2">
                Konfigurimi raportohet vetëm si i pranishëm ose jo. Asnjë vlerë, çelës apo adresë nuk shfaqet këtu.
              </p>
            </Card>

            {m && (
              <Card title="Cache & përsëritje" icon={RiStackLine}>
                <Line label="Norma e cache-it" value={m.cache.hitRate !== null ? `${Math.round(m.cache.hitRate * 100)}%` : '—'} />
                <Line label="Hits / misses" value={`${m.cache.hits.toLocaleString('sq-AL')} / ${m.cache.misses.toLocaleString('sq-AL')}`} />
                <Line label="Hyrje në cache" value={`${m.cacheStore.entries} nga ${m.cacheStore.maxEntries}`} />
                <Line label="Kërkesa në fluturim" value={m.dedupeInFlight} />
                <Line label="Uptime i procesit" value={formatUptime(m.uptimeSeconds)} />
              </Card>
            )}
          </div>

          {m && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card title="Endpoint-et më të ngadaltë" icon={RiSpeedLine}>
                {slowest.length === 0 ? (
                  <p className="text-sm text-slate-400 py-2">Ende pa matje. Përdorni aplikacionin dhe kontrolloni sërish.</p>
                ) : (
                  <div className="space-y-1">
                    {slowest.map(([key, stat]) => (
                      <div key={key} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
                        <span className="text-xs text-slate-600 font-mono truncate">{key.replace('endpoint.', '')}</span>
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          {stat.avgMs} ms mes. · {stat.maxMs} ms maks. · {stat.count}×
                          {stat.slowCount > 0 && <span className="text-amber-600"> · {stat.slowCount} të ngadaltë</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card title="Gabime & varësi" icon={RiDatabase2Line}>
                {errorCounters.length === 0 ? (
                  <p className="text-sm text-slate-400 py-2">Asnjë gabim i regjistruar që nga rinisja e fundit.</p>
                ) : (
                  <div className="space-y-1">
                    {errorCounters.map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
                        <span className="text-xs text-slate-600 font-mono truncate">{key}</span>
                        <span className="text-sm font-semibold text-slate-700">{value.toLocaleString('sq-AL')}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-2">
                  Numëruesit rifillojnë me çdo rinisje të instancës dhe përshkruajnë trafikun e të gjitha organizatave.
                </p>
              </Card>
            </div>
          )}
        </div>
      )}
    </PlatformShell>
  )
}

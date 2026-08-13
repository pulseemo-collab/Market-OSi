'use client'

/**
 * The one badge used for organization lifecycle state across every Platform
 * Owner screen. It renders whatever `resolveOrgState` decided and nothing else,
 * so a tenant cannot read "Aktiv" in a table and "Anuluar" in a detail panel.
 */

import { resolveOrgState, type OrgStateInput } from '@/lib/org-state'
import type { AlertSeverity } from '@/lib/platform-alerts'
import { ALERT_SEVERITY_COLORS, ALERT_SEVERITY_LABELS } from '@/lib/platform-alerts'

export function StateBadge({
  org,
  showDetail = false,
}: {
  org: OrgStateInput
  showDetail?: boolean
}) {
  const state = resolveOrgState(org)
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span
        className={`self-start px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${state.color}`}
      >
        {state.label}
      </span>
      {showDetail && <span className="text-xs text-slate-400 truncate">{state.detail}</span>}
    </div>
  )
}

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${ALERT_SEVERITY_COLORS[severity]}`}
    >
      {ALERT_SEVERITY_LABELS[severity]}
    </span>
  )
}

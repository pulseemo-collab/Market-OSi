/**
 * The Platform Owner attention queue.
 *
 * Every alert here is *derived* from state the system already persists —
 * `Organization.isActive`, the subscription row, and the tenant's last sale.
 * Nothing is stored, nothing is scheduled, and no new notification pipeline
 * exists: an alert is simply a reading of `resolveOrgState` plus a clock.
 *
 * That choice is deliberate. A stored alert table would immediately need
 * creation, deduplication, acknowledgement and expiry logic, and would drift out
 * of sync with the real state the moment a subscription changed. Deriving on
 * read means an alert disappears the instant the underlying condition is fixed.
 *
 * Free of server-only imports so the same derivation runs in the browser and in
 * tests.
 */

import { resolveOrgState, formatOrgDate, type OrgStateInput } from './org-state'

export type AlertKind =
  | 'suspended'
  | 'trial_ending'
  | 'trial_expired'
  | 'subscription_ending'
  | 'cancellation_scheduled'
  | 'expired'
  | 'cancelled'
  | 'no_subscription'
  | 'dormant'

/** How loudly an alert asks for attention. Drives ordering and colour. */
export type AlertSeverity = 'high' | 'medium' | 'low'

export interface AlertOrgInput extends OrgStateInput {
  id: number
  name: string
  /** Timestamp of the tenant's most recent sale, or null if they have never sold. */
  lastActivity?: Date | string | null
  createdAt?: Date | string | null
}

export interface PlatformAlert {
  organizationId: number
  organizationName: string
  kind: AlertKind
  severity: AlertSeverity
  /** Short headline, e.g. "Prova mbaron së shpejti". */
  title: string
  /** One sentence with the concrete date or count. */
  detail: string
  /** Whole days until the alert's deadline; negative once it has passed. */
  daysRemaining: number | null
}

/** A trial inside this many days of expiry is worth chasing. */
export const TRIAL_WARNING_DAYS = 7
/** A paid subscription inside this many days of expiry needs a renewal nudge. */
export const RENEWAL_WARNING_DAYS = 14
/** No sales for this long, while entitled to access, reads as a stalled customer. */
export const DORMANT_DAYS = 30

const DAY_MS = 86_400_000

const SEVERITY_ORDER: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 }

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole days from `now` until `target`, rounded up so "in 4h" reads as 1 day. */
function daysUntil(target: Date | null, now: Date): number | null {
  if (!target) return null
  return Math.ceil((target.getTime() - now.getTime()) / DAY_MS)
}

function plural(days: number): string {
  return days === 1 ? '1 ditë' : `${days} ditë`
}

/**
 * Every alert an organization currently warrants. Most tenants produce none.
 *
 * A tenant can legitimately raise more than one — a suspended organization whose
 * trial also lapsed is two separate operational facts — but the states that
 * exclude each other (suspended vs. trialing) cannot both appear, because
 * `resolveOrgState` collapses them into a single `kind` first.
 */
export function deriveOrgAlerts(org: AlertOrgInput, now: Date = new Date()): PlatformAlert[] {
  const state = resolveOrgState(org, now)
  const alerts: PlatformAlert[] = []

  const base = { organizationId: org.id, organizationName: org.name }

  switch (state.kind) {
    case 'suspended':
      alerts.push({
        ...base,
        kind: 'suspended',
        severity: 'high',
        title: 'Organizata është pezulluar',
        detail: 'Aksesi është bllokuar nga platforma. Të dhënat janë ruajtur.',
        daysRemaining: null,
      })
      break

    case 'no_subscription':
      alerts.push({
        ...base,
        kind: 'no_subscription',
        severity: 'high',
        title: 'Pa abonim',
        detail: 'Nuk ka asnjë abonim të regjistruar — aksesi është i bllokuar.',
        daysRemaining: null,
      })
      break

    case 'trial_expired':
      alerts.push({
        ...base,
        kind: 'trial_expired',
        severity: 'high',
        title: 'Prova ka skaduar',
        detail: `Prova mbaroi më ${formatOrgDate(state.effectiveUntil)} dhe nuk u konvertua në abonim.`,
        daysRemaining: daysUntil(state.effectiveUntil, now),
      })
      break

    case 'expired':
      alerts.push({
        ...base,
        kind: 'expired',
        severity: 'high',
        title: 'Abonimi ka skaduar',
        detail: `Abonimi skadoi më ${formatOrgDate(state.effectiveUntil)} — aksesi është i bllokuar.`,
        daysRemaining: daysUntil(state.effectiveUntil, now),
      })
      break

    case 'cancelled':
      alerts.push({
        ...base,
        kind: 'cancelled',
        severity: 'medium',
        title: 'Abonimi u anulua',
        detail: 'Abonimi është anuluar dhe aksesi është ndërprerë.',
        daysRemaining: null,
      })
      break

    case 'cancelling': {
      const days = daysUntil(state.effectiveUntil, now)
      alerts.push({
        ...base,
        kind: 'cancellation_scheduled',
        severity: days !== null && days <= RENEWAL_WARNING_DAYS ? 'high' : 'medium',
        title: 'Klienti anuloi rinovimin',
        detail:
          days !== null
            ? `Aksesi mbaron më ${formatOrgDate(state.effectiveUntil)} (${plural(days)}).`
            : `Aksesi mbaron më ${formatOrgDate(state.effectiveUntil)}.`,
        daysRemaining: days,
      })
      break
    }

    case 'trialing': {
      const days = daysUntil(state.effectiveUntil, now)
      if (days !== null && days <= TRIAL_WARNING_DAYS) {
        alerts.push({
          ...base,
          kind: 'trial_ending',
          severity: days <= 3 ? 'high' : 'medium',
          title: 'Prova mbaron së shpejti',
          detail: `Prova mbaron më ${formatOrgDate(state.effectiveUntil)} (${plural(days)}).`,
          daysRemaining: days,
        })
      }
      break
    }

    case 'active': {
      const days = daysUntil(state.effectiveUntil, now)
      if (days !== null && days <= RENEWAL_WARNING_DAYS) {
        alerts.push({
          ...base,
          kind: 'subscription_ending',
          severity: days <= 3 ? 'high' : 'medium',
          title: 'Abonimi mbaron së shpejti',
          detail: `Abonimi mbaron më ${formatOrgDate(state.effectiveUntil)} (${plural(days)}).`,
          daysRemaining: days,
        })
      }
      break
    }
  }

  // Dormancy is only meaningful for a tenant that *can* use the product. An
  // expired account with no sales is already covered by its expiry alert, and
  // reporting both would just double-count the same customer problem.
  if (state.hasAccess) {
    const last = toDate(org.lastActivity)
    const created = toDate(org.createdAt)
    const reference = last ?? created

    if (reference) {
      const idleDays = Math.floor((now.getTime() - reference.getTime()) / DAY_MS)
      if (idleDays >= DORMANT_DAYS) {
        alerts.push({
          ...base,
          kind: 'dormant',
          severity: 'low',
          title: last ? 'Pa aktivitet së fundmi' : 'Asnjë shitje që nga krijimi',
          detail: last
            ? `Shitja e fundit ${plural(idleDays)} më parë (${formatOrgDate(last)}).`
            : `Krijuar ${plural(idleDays)} më parë pa asnjë shitje.`,
          daysRemaining: -idleDays,
        })
      }
    }
  }

  return alerts
}

/**
 * Alerts for a whole portfolio, most urgent first. Within a severity the
 * nearest deadline leads, so "mbaron nesër" sorts above "mbaron pas 12 ditësh".
 */
export function derivePlatformAlerts(
  orgs: AlertOrgInput[],
  now: Date = new Date(),
): PlatformAlert[] {
  const all = orgs.flatMap((org) => deriveOrgAlerts(org, now))

  return all.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (bySeverity !== 0) return bySeverity

    // Alerts without a deadline (suspension, no subscription) sit after dated
    // ones of the same severity — they are not getting more urgent by the hour.
    const aDays = a.daysRemaining ?? Number.MAX_SAFE_INTEGER
    const bDays = b.daysRemaining ?? Number.MAX_SAFE_INTEGER
    if (aDays !== bDays) return aDays - bDays

    return a.organizationName.localeCompare(b.organizationName, 'sq')
  })
}

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  high: 'Urgjente',
  medium: 'Për vëmendje',
  low: 'Informative',
}

export const ALERT_SEVERITY_COLORS: Record<AlertSeverity, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-orange-100 text-orange-700',
  low: 'bg-slate-100 text-slate-600',
}

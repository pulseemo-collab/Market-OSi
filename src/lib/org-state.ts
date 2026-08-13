/**
 * The single reading of an organization's lifecycle state.
 *
 * Three independent things were previously collapsed into one "Aktiv" badge:
 *
 *   1. whether the subscription entitles the tenant to access,
 *   2. whether the customer has cancelled their renewal,
 *   3. whether the platform operator has suspended the tenant.
 *
 * They are stored separately and correctly — `Organization.isActive`,
 * `Subscription.status`, `Subscription.cancelAtPeriodEnd` — but each screen
 * re-derived its own label from a subset of them, so a customer cancellation
 * showed up as an ordinary active subscription and a suspension showed up as
 * nothing at all. This module is the one place that reads all three, and every
 * label in the product comes from here.
 *
 * Free of server-only imports so client components can use it directly.
 */

export type OrgStateKind =
  | 'suspended'
  | 'no_subscription'
  | 'trialing'
  | 'trial_expired'
  | 'cancelling'
  | 'active'
  | 'expired'
  | 'cancelled'

export interface OrgStateInput {
  isActive: boolean
  subscription: {
    plan: string
    status: string
    trialEndsAt: Date | string | null
    currentPeriodEnd: Date | string | null
    cancelAtPeriodEnd?: boolean | null
    cancelledAt?: Date | string | null
  } | null
}

export interface OrgState {
  kind: OrgStateKind
  /** Short badge text, e.g. "Anuluar". */
  label: string
  /** Full sentence including the effective date where one applies. */
  detail: string
  /** Tailwind classes matching the existing badge palette. */
  color: string
  /** Whether this state currently permits normal application access. */
  hasAccess: boolean
  /** Date access ends (period or trial end), when the state has one. */
  effectiveUntil: Date | null
  /** True when the customer has asked not to renew but is still inside the paid period. */
  cancellationScheduled: boolean
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** DD/MM/YYYY — the format already used across the Albanian UI. */
export function formatOrgDate(value: Date | string | null | undefined): string {
  const d = toDate(value)
  if (!d) return '—'
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export function resolveOrgState(input: OrgStateInput, now: Date = new Date()): OrgState {
  // Administrative suspension outranks everything: it is the operator's decision
  // and no billing state can override it.
  if (!input.isActive) {
    return {
      kind: 'suspended',
      label: 'Pezulluar',
      detail: 'Pezulluar nga platforma — aksesi është bllokuar, të dhënat janë ruajtur',
      color: 'bg-red-100 text-red-700',
      hasAccess: false,
      effectiveUntil: null,
      cancellationScheduled: false,
    }
  }

  const sub = input.subscription

  if (!sub) {
    return {
      kind: 'no_subscription',
      label: 'Pa abonim',
      detail: 'Nuk ka abonim të regjistruar',
      color: 'bg-slate-100 text-slate-500',
      hasAccess: false,
      effectiveUntil: null,
      cancellationScheduled: false,
    }
  }

  const trialEndsAt = toDate(sub.trialEndsAt)
  const periodEnd = toDate(sub.currentPeriodEnd)

  if (sub.status === 'trialing') {
    // A trial with no end date never expires, matching checkSubscriptionAccess.
    const live = !trialEndsAt || trialEndsAt > now
    return live
      ? {
          kind: 'trialing',
          label: 'Provë',
          detail: trialEndsAt ? `Provë — aktiv deri më ${formatOrgDate(trialEndsAt)}` : 'Provë — pa afat',
          color: 'bg-yellow-100 text-yellow-700',
          hasAccess: true,
          effectiveUntil: trialEndsAt,
          cancellationScheduled: false,
        }
      : {
          kind: 'trial_expired',
          label: 'Provë e skaduar',
          detail: `Provë e skaduar më ${formatOrgDate(trialEndsAt)}`,
          color: 'bg-slate-100 text-slate-500',
          hasAccess: false,
          effectiveUntil: trialEndsAt,
          cancellationScheduled: false,
        }
  }

  if (sub.status === 'active') {
    const live = !periodEnd || periodEnd > now

    if (!live) {
      return {
        kind: 'expired',
        label: 'Skaduar',
        detail: `Abonimi skadoi më ${formatOrgDate(periodEnd)}`,
        color: 'bg-slate-100 text-slate-500',
        hasAccess: false,
        effectiveUntil: periodEnd,
        cancellationScheduled: false,
      }
    }

    // The case the platform view used to lose entirely: the customer stopped
    // their renewal but has paid through to a future date.
    if (sub.cancelAtPeriodEnd) {
      return {
        kind: 'cancelling',
        label: 'Anuluar',
        detail: `Anuluar — aktiv deri më ${formatOrgDate(periodEnd)}`,
        color: 'bg-orange-100 text-orange-700',
        hasAccess: true,
        effectiveUntil: periodEnd,
        cancellationScheduled: true,
      }
    }

    return {
      kind: 'active',
      label: 'Aktiv',
      detail: periodEnd ? `Aktiv deri më ${formatOrgDate(periodEnd)}` : 'Aktiv — pa afat',
      color: 'bg-green-100 text-green-700',
      hasAccess: true,
      effectiveUntil: periodEnd,
      cancellationScheduled: false,
    }
  }

  if (sub.status === 'cancelled') {
    return {
      kind: 'cancelled',
      label: 'Anuluar',
      detail: sub.cancelledAt
        ? `Anuluar më ${formatOrgDate(sub.cancelledAt)} — aksesi është ndërprerë`
        : 'Anuluar — aksesi është ndërprerë',
      color: 'bg-red-100 text-red-700',
      hasAccess: false,
      effectiveUntil: periodEnd,
      cancellationScheduled: false,
    }
  }

  // 'expired' and any status added later fail closed, as the access check does.
  return {
    kind: 'expired',
    label: 'Skaduar',
    detail: periodEnd ? `Abonimi skadoi më ${formatOrgDate(periodEnd)}` : 'Abonimi ka skaduar',
    color: 'bg-slate-100 text-slate-500',
    hasAccess: false,
    effectiveUntil: periodEnd,
    cancellationScheduled: false,
  }
}

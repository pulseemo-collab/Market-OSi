export const BILLING_PLANS = {
  free:       { label: 'Falas',      color: 'bg-slate-100 text-slate-600',   order: 0 },
  starter:    { label: 'Starter',    color: 'bg-blue-100 text-blue-700',     order: 1 },
  pro:        { label: 'Pro',        color: 'bg-violet-100 text-violet-700', order: 2 },
  enterprise: { label: 'Enterprise', color: 'bg-amber-100 text-amber-700',   order: 3 },
} as const

export type BillingPlan = keyof typeof BILLING_PLANS

export const BILLING_STATUSES = {
  trial:    { label: 'Provë',     color: 'bg-yellow-100 text-yellow-700' },
  active:   { label: 'Aktiv',     color: 'bg-green-100 text-green-700'   },
  past_due: { label: 'Me Vonesë', color: 'bg-orange-100 text-orange-700' },
  canceled: { label: 'Anuluar',   color: 'bg-red-100 text-red-700'       },
  expired:  { label: 'Skaduar',   color: 'bg-slate-100 text-slate-500'   },
} as const

export type BillingStatus = keyof typeof BILLING_STATUSES

export const BILLING_AUDIT_ACTIONS = {
  CREATED:        'created',
  PLAN_CHANGED:   'plan_changed',
  STATUS_CHANGED: 'status_changed',
  TRIAL_STARTED:  'trial_started',
  ACTIVATED:      'activated',
  CANCELED:       'canceled',
  DATES_UPDATED:  'dates_updated',
  NOTES_UPDATED:  'notes_updated',
} as const

export const BILLING_AUDIT_ACTION_LABELS: Record<string, string> = {
  created:        'Krijuar',
  plan_changed:   'Plan Ndryshuar',
  status_changed: 'Status Ndryshuar',
  trial_started:  'Provë Nisur',
  activated:      'Aktivizuar',
  canceled:       'Anuluar',
  dates_updated:  'Datat Përditësuar',
  notes_updated:  'Shënime Përditësuara',
}

export function getPlanInfo(plan: string) {
  return BILLING_PLANS[plan as BillingPlan] ?? { label: plan, color: 'bg-slate-100 text-slate-500', order: -1 }
}

export function getStatusInfo(status: string) {
  return BILLING_STATUSES[status as BillingStatus] ?? { label: status, color: 'bg-slate-100 text-slate-500' }
}

export function isValidPlan(plan: string): plan is BillingPlan {
  return plan in BILLING_PLANS
}

export function isValidStatus(status: string): status is BillingStatus {
  return status in BILLING_STATUSES
}

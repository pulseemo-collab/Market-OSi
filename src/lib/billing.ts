export const BILLING_PLANS = {
  trial:    { label: 'Provë',    color: 'bg-yellow-100 text-yellow-700', order: 0 },
  basic:    { label: 'Basic',    color: 'bg-blue-100 text-blue-700',     order: 1 },
  pro:      { label: 'Pro',      color: 'bg-violet-100 text-violet-700', order: 2 },
  internal: { label: 'Internal', color: 'bg-slate-100 text-slate-600',   order: 3 },
} as const

export type BillingPlan = keyof typeof BILLING_PLANS

export const BILLING_STATUSES = {
  trialing:  { label: 'Provë',   color: 'bg-yellow-100 text-yellow-700' },
  active:    { label: 'Aktiv',   color: 'bg-green-100 text-green-700'   },
  expired:   { label: 'Skaduar', color: 'bg-slate-100 text-slate-500'   },
  cancelled: { label: 'Anuluar', color: 'bg-red-100 text-red-700'       },
} as const

export type BillingStatus = keyof typeof BILLING_STATUSES

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

// Configurable pricing (change these values to update prices everywhere)
export const PLAN_PRICES = {
  monthly: 2990, // ALL/month
  yearly:  24900, // ALL/year
} as const

export const BILLING_PLANS = {
  trial:    { label: 'Provë',    color: 'bg-yellow-100 text-yellow-700', order: 0 },
  monthly:  { label: 'Mujor',   color: 'bg-blue-100 text-blue-700',     order: 1 },
  yearly:   { label: 'Vjetor',  color: 'bg-emerald-100 text-emerald-700', order: 2 },
  basic:    { label: 'Basic',    color: 'bg-blue-100 text-blue-700',     order: 3 },
  pro:      { label: 'Pro',      color: 'bg-violet-100 text-violet-700', order: 4 },
  internal: { label: 'Internal', color: 'bg-slate-100 text-slate-600',   order: 5 },
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

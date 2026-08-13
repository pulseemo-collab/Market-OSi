/**
 * Search, filter and sort for the Platform Owner organization list.
 *
 * Filtering and ordering happen here, in application code, rather than in SQL.
 * That is a deliberate trade: an organization's lifecycle state is a function of
 * three columns across two tables plus the current clock, and expressing it as a
 * WHERE clause would mean writing the rules a second time — in a dialect where
 * they could silently drift away from `resolveOrgState`. A tenant would then be
 * badged "Anuluar" in the table while the "Aktiv" filter still returned it.
 *
 * The cost is bounded by `ORG_SCAN_LIMIT`: the query that feeds this returns at
 * most that many rows, with per-organization counts computed by the database as
 * aggregates rather than by loading any nested records.
 *
 * Free of server-only imports so the same rules are unit-testable.
 */

import { resolveOrgState, type OrgStateKind } from './org-state'

/** Ceiling on how many organizations one listing request may scan. */
export const ORG_SCAN_LIMIT = 500

export const ORG_SORT_KEYS = [
  'name',
  'createdAt',
  'lastActivity',
  'entitlementEnd',
  'sales',
  'users',
  'products',
  'state',
] as const

export type OrgSortKey = (typeof ORG_SORT_KEYS)[number]
export type SortDirection = 'asc' | 'desc'

export const ORG_SORT_LABELS: Record<OrgSortKey, string> = {
  name: 'Emri',
  createdAt: 'Data e krijimit',
  lastActivity: 'Aktiviteti i fundit',
  entitlementEnd: 'Skadimi i aksesit',
  sales: 'Shitjet',
  users: 'Përdoruesit',
  products: 'Produktet',
  state: 'Gjendja',
}

/** Filter values beyond the eight lifecycle kinds. */
export type OrgStateFilter = OrgStateKind | 'all' | 'with_access' | 'without_access' | 'attention'

export interface OrgListRow {
  id: number
  name: string
  isActive: boolean
  usersCount: number
  staffCount: number
  productsCount: number
  salesCount: number
  lastActivity: Date | string | null
  createdAt: Date | string
  subscription: {
    plan: string
    status: string
    trialEndsAt: Date | string | null
    currentPeriodEnd: Date | string | null
    nextPlan?: string | null
    cancelAtPeriodEnd?: boolean | null
    cancelledAt?: Date | string | null
  } | null
}

export interface OrgListQuery {
  q: string
  state: OrgStateFilter
  plan: string | 'all'
  sort: OrgSortKey
  dir: SortDirection
  page: number
  pageSize: number
}

export const DEFAULT_ORG_PAGE_SIZE = 25
const MAX_ORG_PAGE_SIZE = 100

function isSortKey(value: string): value is OrgSortKey {
  return (ORG_SORT_KEYS as readonly string[]).includes(value)
}

/** Reads the listing query string, clamping every value into a safe range. */
export function parseOrgListQuery(params: URLSearchParams): OrgListQuery {
  const rawSort = params.get('sort') ?? ''
  const rawDir = params.get('dir') ?? ''
  const rawPage = parseInt(params.get('page') ?? '1', 10)
  const rawPageSize = parseInt(params.get('pageSize') ?? '', 10)

  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    state: (params.get('state') ?? 'all') as OrgStateFilter,
    plan: (params.get('plan') ?? 'all').slice(0, 30),
    sort: isSortKey(rawSort) ? rawSort : 'createdAt',
    dir: rawDir === 'asc' ? 'asc' : 'desc',
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize:
      Number.isFinite(rawPageSize) && rawPageSize > 0
        ? Math.min(rawPageSize, MAX_ORG_PAGE_SIZE)
        : DEFAULT_ORG_PAGE_SIZE,
  }
}

/** Ordering used when sorting by state, from most to least urgent. */
const STATE_URGENCY: Record<OrgStateKind, number> = {
  suspended: 0,
  no_subscription: 1,
  trial_expired: 2,
  expired: 3,
  cancelled: 4,
  cancelling: 5,
  trialing: 6,
  active: 7,
}

/** Lifecycle kinds that mean an operator should look at the tenant. */
const ATTENTION_KINDS: OrgStateKind[] = [
  'suspended',
  'no_subscription',
  'trial_expired',
  'expired',
  'cancelled',
  'cancelling',
]

export interface ResolvedOrgRow extends OrgListRow {
  state: ReturnType<typeof resolveOrgState>
}

function time(value: Date | string | null | undefined): number | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

function matchesState(kind: OrgStateKind, hasAccess: boolean, filter: OrgStateFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'with_access':
      return hasAccess
    case 'without_access':
      return !hasAccess
    case 'attention':
      return ATTENTION_KINDS.includes(kind)
    default:
      return kind === filter
  }
}

/**
 * Applies search, state and plan filters, then orders the result.
 *
 * Rows without a value for the sort key (a tenant that has never sold, a
 * subscription with no end date) always sort last regardless of direction —
 * flipping the direction should reorder the tenants that *have* the attribute,
 * not promote the ones that lack it entirely.
 */
export function selectOrgRows(
  rows: OrgListRow[],
  query: OrgListQuery,
  now: Date = new Date(),
): { total: number; rows: ResolvedOrgRow[] } {
  const needle = query.q.toLowerCase()

  const resolved: ResolvedOrgRow[] = rows.map((row) => ({
    ...row,
    state: resolveOrgState(row, now),
  }))

  const filtered = resolved.filter((row) => {
    if (needle) {
      const haystack = `${row.name} #${row.id}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    if (query.plan !== 'all' && (row.subscription?.plan ?? '') !== query.plan) return false
    return matchesState(row.state.kind, row.state.hasAccess, query.state)
  })

  const factor = query.dir === 'asc' ? 1 : -1

  const sorted = filtered.sort((a, b) => {
    switch (query.sort) {
      case 'name':
        return factor * a.name.localeCompare(b.name, 'sq')
      case 'sales':
        return factor * (a.salesCount - b.salesCount)
      case 'users':
        return factor * (a.usersCount + a.staffCount - (b.usersCount + b.staffCount))
      case 'products':
        return factor * (a.productsCount - b.productsCount)
      case 'state':
        return factor * (STATE_URGENCY[a.state.kind] - STATE_URGENCY[b.state.kind])
      default: {
        const pick = (row: ResolvedOrgRow): number | null => {
          if (query.sort === 'createdAt') return time(row.createdAt)
          if (query.sort === 'lastActivity') return time(row.lastActivity)
          return time(row.state.effectiveUntil)
        }
        const av = pick(a)
        const bv = pick(b)
        if (av === null && bv === null) return 0
        if (av === null) return 1
        if (bv === null) return -1
        return factor * (av - bv)
      }
    }
  })

  const start = (query.page - 1) * query.pageSize
  return { total: sorted.length, rows: sorted.slice(start, start + query.pageSize) }
}

/** Portfolio tally by lifecycle state, used by the overview and the filter chips. */
export function countByState(
  rows: OrgListRow[],
  now: Date = new Date(),
): Record<OrgStateKind, number> {
  const counts = {
    suspended: 0,
    no_subscription: 0,
    trialing: 0,
    trial_expired: 0,
    cancelling: 0,
    active: 0,
    expired: 0,
    cancelled: 0,
  } as Record<OrgStateKind, number>

  for (const row of rows) counts[resolveOrgState(row, now).kind] += 1
  return counts
}

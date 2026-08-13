/**
 * Organization list search, filtering, sorting and paging.
 *
 * The risk these cover is a filter that disagrees with the badge next to it:
 * because lifecycle state is derived rather than stored, "show me the cancelled
 * ones" and "this row says Anuluar" are two separate code paths that must reach
 * the same conclusion. Every test here drives the same `resolveOrgState` the UI
 * renders.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseOrgListQuery,
  selectOrgRows,
  countByState,
  DEFAULT_ORG_PAGE_SIZE,
  type OrgListRow,
} from '../src/lib/platform-orgs'

const NOW = new Date('2026-08-13T12:00:00.000Z')
const DAY = 86_400_000
const at = (days: number) => new Date(NOW.getTime() + days * DAY)

function row(over: Partial<OrgListRow> & { id: number; name: string }): OrgListRow {
  return {
    isActive: true,
    usersCount: 1,
    staffCount: 0,
    productsCount: 10,
    salesCount: 5,
    lastActivity: at(-1),
    createdAt: at(-100),
    subscription: {
      plan: 'monthly',
      status: 'active',
      trialEndsAt: null,
      currentPeriodEnd: at(30),
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    },
    ...over,
  }
}

const ACTIVE      = row({ id: 1, name: 'Alfa Market' })
const TRIALING    = row({
  id: 2, name: 'Beta Market',
  subscription: { plan: 'trial', status: 'trialing', trialEndsAt: at(5), currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelledAt: null },
})
const CANCELLING  = row({
  id: 3, name: 'Gama Market',
  subscription: { plan: 'yearly', status: 'active', trialEndsAt: null, currentPeriodEnd: at(20), cancelAtPeriodEnd: true, cancelledAt: at(-3) },
})
const SUSPENDED   = row({ id: 4, name: 'Delta Market', isActive: false })
const EXPIRED     = row({
  id: 5, name: 'Epsilon Market',
  subscription: { plan: 'monthly', status: 'active', trialEndsAt: null, currentPeriodEnd: at(-10), cancelAtPeriodEnd: false, cancelledAt: null },
})
const NO_SUB      = row({ id: 6, name: 'Zeta Market', subscription: null })

const ALL = [ACTIVE, TRIALING, CANCELLING, SUSPENDED, EXPIRED, NO_SUB]

function q(over: Partial<ReturnType<typeof parseOrgListQuery>> = {}) {
  return { ...parseOrgListQuery(new URLSearchParams()), ...over }
}

const ids = (rows: { id: number }[]) => rows.map((r) => r.id)

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

test('an empty query string yields safe defaults', () => {
  const parsed = parseOrgListQuery(new URLSearchParams())
  assert.equal(parsed.q, '')
  assert.equal(parsed.state, 'all')
  assert.equal(parsed.plan, 'all')
  assert.equal(parsed.sort, 'createdAt')
  assert.equal(parsed.dir, 'desc')
  assert.equal(parsed.page, 1)
  assert.equal(parsed.pageSize, DEFAULT_ORG_PAGE_SIZE)
})

test('an unknown sort key falls back rather than reaching the sorter', () => {
  assert.equal(parseOrgListQuery(new URLSearchParams('sort=DROP TABLE')).sort, 'createdAt')
})

test('page and pageSize are clamped against hostile input', () => {
  const parsed = parseOrgListQuery(new URLSearchParams('page=-4&pageSize=100000'))
  assert.equal(parsed.page, 1)
  assert.ok(parsed.pageSize <= 100, 'page size must stay bounded')

  assert.equal(parseOrgListQuery(new URLSearchParams('page=abc')).page, 1)
  assert.equal(parseOrgListQuery(new URLSearchParams('pageSize=0')).pageSize, DEFAULT_ORG_PAGE_SIZE)
})

test('a very long search term is truncated', () => {
  const parsed = parseOrgListQuery(new URLSearchParams(`q=${'x'.repeat(500)}`))
  assert.equal(parsed.q.length, 100)
})

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test('search matches organization name case-insensitively', () => {
  assert.deepEqual(ids(selectOrgRows(ALL, q({ q: 'gama' }), NOW).rows), [3])
  assert.deepEqual(ids(selectOrgRows(ALL, q({ q: 'GAMA' }), NOW).rows), [3])
})

test('search matches an id typed with a hash', () => {
  assert.deepEqual(ids(selectOrgRows(ALL, q({ q: '#5' }), NOW).rows), [5])
})

test('a search that matches nothing returns an empty page, not everything', () => {
  const result = selectOrgRows(ALL, q({ q: 'nuk-ekziston' }), NOW)
  assert.equal(result.total, 0)
  assert.deepEqual(result.rows, [])
})

// ---------------------------------------------------------------------------
// State filtering
// ---------------------------------------------------------------------------

test('each lifecycle filter returns exactly its own tenants', () => {
  assert.deepEqual(ids(selectOrgRows(ALL, q({ state: 'active' }), NOW).rows), [1])
  assert.deepEqual(ids(selectOrgRows(ALL, q({ state: 'trialing' }), NOW).rows), [2])
  assert.deepEqual(ids(selectOrgRows(ALL, q({ state: 'cancelling' }), NOW).rows), [3])
  assert.deepEqual(ids(selectOrgRows(ALL, q({ state: 'suspended' }), NOW).rows), [4])
  assert.deepEqual(ids(selectOrgRows(ALL, q({ state: 'expired' }), NOW).rows), [5])
  assert.deepEqual(ids(selectOrgRows(ALL, q({ state: 'no_subscription' }), NOW).rows), [6])
})

test('a tenant that cancelled its renewal is not returned by the active filter', () => {
  // The exact confusion the state model exists to prevent.
  const active = ids(selectOrgRows(ALL, q({ state: 'active' }), NOW).rows)
  assert.ok(!active.includes(CANCELLING.id))
})

test('a suspended tenant is not returned by the active filter even though it is paid up', () => {
  const active = ids(selectOrgRows(ALL, q({ state: 'active' }), NOW).rows)
  assert.ok(!active.includes(SUSPENDED.id))
})

test('access filters split the portfolio into exactly two halves', () => {
  const withAccess = ids(selectOrgRows(ALL, q({ state: 'with_access' }), NOW).rows).sort()
  const without = ids(selectOrgRows(ALL, q({ state: 'without_access' }), NOW).rows).sort()

  assert.deepEqual(withAccess, [1, 2, 3], 'active, trialing and mid-cancellation still have access')
  assert.deepEqual(without, [4, 5, 6])
  assert.equal(withAccess.length + without.length, ALL.length)
})

test('the attention filter surfaces every state that needs an operator decision', () => {
  const attention = ids(selectOrgRows(ALL, q({ state: 'attention' }), NOW).rows).sort()
  assert.deepEqual(attention, [3, 4, 5, 6])
  assert.ok(!attention.includes(1), 'a healthy paying tenant needs no attention')
  assert.ok(!attention.includes(2), 'a running trial needs no attention')
})

test('the plan filter is independent of the state filter', () => {
  assert.deepEqual(ids(selectOrgRows(ALL, q({ plan: 'yearly' }), NOW).rows), [3])
  assert.deepEqual(ids(selectOrgRows(ALL, q({ plan: 'trial' }), NOW).rows), [2])
})

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

test('sorting by name honours the requested direction', () => {
  const asc = selectOrgRows(ALL, q({ sort: 'name', dir: 'asc' }), NOW).rows.map((r) => r.name)
  const desc = selectOrgRows(ALL, q({ sort: 'name', dir: 'desc' }), NOW).rows.map((r) => r.name)
  assert.equal(asc[0], 'Alfa Market')
  assert.deepEqual(desc, [...asc].reverse())
})

test('sorting by sales orders numerically', () => {
  const rows = [
    row({ id: 1, name: 'A', salesCount: 3 }),
    row({ id: 2, name: 'B', salesCount: 40 }),
    row({ id: 3, name: 'C', salesCount: 12 }),
  ]
  assert.deepEqual(ids(selectOrgRows(rows, q({ sort: 'sales', dir: 'desc' }), NOW).rows), [2, 3, 1])
})

test('rows missing the sort value sort last in both directions', () => {
  const rows = [
    row({ id: 1, name: 'Has activity', lastActivity: at(-5) }),
    row({ id: 2, name: 'Never sold', lastActivity: null }),
    row({ id: 3, name: 'Sold today', lastActivity: at(0) }),
  ]
  const desc = ids(selectOrgRows(rows, q({ sort: 'lastActivity', dir: 'desc' }), NOW).rows)
  const asc = ids(selectOrgRows(rows, q({ sort: 'lastActivity', dir: 'asc' }), NOW).rows)

  assert.equal(desc[desc.length - 1], 2, 'a tenant with no activity should not lead any ordering')
  assert.equal(asc[asc.length - 1], 2)
})

test('sorting by entitlement end uses the resolved state, not the raw column', () => {
  // TRIALING has no currentPeriodEnd at all; its deadline is trialEndsAt.
  const rows = [ACTIVE, TRIALING, CANCELLING]
  const asc = ids(selectOrgRows(rows, q({ sort: 'entitlementEnd', dir: 'asc' }), NOW).rows)
  assert.deepEqual(asc, [2, 3, 1], 'trial (5d) before cancellation (20d) before active (30d)')
})

test('sorting by state puts the most urgent tenants first', () => {
  const order = ids(selectOrgRows(ALL, q({ sort: 'state', dir: 'asc' }), NOW).rows)
  assert.equal(order[0], SUSPENDED.id)
  assert.equal(order[order.length - 1], ACTIVE.id)
})

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

test('paging reports the full filtered total, not the page length', () => {
  const first = selectOrgRows(ALL, q({ sort: 'name', dir: 'asc', page: 1, pageSize: 2 }), NOW)
  assert.equal(first.total, 6)
  assert.equal(first.rows.length, 2)

  const second = selectOrgRows(ALL, q({ sort: 'name', dir: 'asc', page: 2, pageSize: 2 }), NOW)
  assert.equal(second.total, 6)
  assert.deepEqual(
    ids(second.rows).filter((id) => ids(first.rows).includes(id)),
    [],
    'pages must not overlap',
  )
})

test('a page past the end is empty rather than wrapping around', () => {
  const result = selectOrgRows(ALL, q({ page: 99, pageSize: 25 }), NOW)
  assert.equal(result.total, 6)
  assert.deepEqual(result.rows, [])
})

test('every row is reachable by paging through the whole list once', () => {
  const seen: number[] = []
  for (let page = 1; page <= 3; page++) {
    seen.push(...ids(selectOrgRows(ALL, q({ sort: 'name', dir: 'asc', page, pageSize: 2 }), NOW).rows))
  }
  assert.deepEqual(seen.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6])
})

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

test('state counts cover every tenant exactly once', () => {
  const counts = countByState(ALL, NOW)
  assert.equal(counts.active, 1)
  assert.equal(counts.trialing, 1)
  assert.equal(counts.cancelling, 1)
  assert.equal(counts.suspended, 1)
  assert.equal(counts.expired, 1)
  assert.equal(counts.no_subscription, 1)
  assert.equal(
    Object.values(counts).reduce((a, b) => a + b, 0),
    ALL.length,
  )
})

test('counts start at zero for states nobody is in', () => {
  const counts = countByState([ACTIVE], NOW)
  assert.equal(counts.suspended, 0)
  assert.equal(counts.cancelled, 0)
  assert.equal(counts.trial_expired, 0)
})

test('an empty portfolio counts zero everywhere instead of throwing', () => {
  const counts = countByState([], NOW)
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 0)
})

test('ISO strings from the API filter and sort like Date objects', () => {
  const asDates = selectOrgRows(ALL, q({ state: 'cancelling' }), NOW)
  const asStrings = selectOrgRows(
    ALL.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt).toISOString(),
      lastActivity: r.lastActivity ? new Date(r.lastActivity).toISOString() : null,
      subscription: r.subscription
        ? {
            ...r.subscription,
            trialEndsAt: r.subscription.trialEndsAt ? new Date(r.subscription.trialEndsAt).toISOString() : null,
            currentPeriodEnd: r.subscription.currentPeriodEnd ? new Date(r.subscription.currentPeriodEnd).toISOString() : null,
            cancelledAt: r.subscription.cancelledAt ? new Date(r.subscription.cancelledAt).toISOString() : null,
          }
        : null,
    })),
    q({ state: 'cancelling' }),
    NOW,
  )
  assert.deepEqual(ids(asStrings.rows), ids(asDates.rows))
})

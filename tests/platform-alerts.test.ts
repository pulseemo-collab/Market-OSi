/**
 * Platform Owner alert derivation.
 *
 * The property these protect: an alert exists exactly when the underlying state
 * warrants it, and disappears when it does not. Because nothing is stored, a
 * wrong rule here is not a stale row an operator can dismiss — it is a customer
 * who silently never appears in the attention queue.
 *
 * Every assertion pins an absolute instant so results never depend on the clock.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  deriveOrgAlerts,
  derivePlatformAlerts,
  DORMANT_DAYS,
  RENEWAL_WARNING_DAYS,
  TRIAL_WARNING_DAYS,
  type AlertOrgInput,
} from '../src/lib/platform-alerts'

const NOW = new Date('2026-08-13T12:00:00.000Z')
const DAY = 86_400_000

function at(days: number): Date {
  return new Date(NOW.getTime() + days * DAY)
}

function org(over: Partial<AlertOrgInput> = {}): AlertOrgInput {
  return {
    id: 1,
    name: 'Market Test',
    isActive: true,
    // Recent activity by default, so dormancy never fires unless a test asks.
    lastActivity: at(-1),
    createdAt: at(-200),
    subscription: {
      plan: 'monthly',
      status: 'active',
      trialEndsAt: null,
      currentPeriodEnd: at(90),
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    },
    ...over,
  }
}

const kinds = (input: AlertOrgInput) => deriveOrgAlerts(input, NOW).map((a) => a.kind)

// ---------------------------------------------------------------------------
// Quiet by default
// ---------------------------------------------------------------------------

test('a healthy, active, recently used tenant raises nothing', () => {
  assert.deepEqual(kinds(org()), [])
})

test('a trial with plenty of time left raises nothing', () => {
  const input = org({
    subscription: {
      plan: 'trial', status: 'trialing', trialEndsAt: at(TRIAL_WARNING_DAYS + 5),
      currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelledAt: null,
    },
  })
  assert.deepEqual(kinds(input), [])
})

// ---------------------------------------------------------------------------
// Access-blocking states
// ---------------------------------------------------------------------------

test('a suspended tenant raises a high-severity suspension alert', () => {
  const alerts = deriveOrgAlerts(org({ isActive: false }), NOW)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].kind, 'suspended')
  assert.equal(alerts[0].severity, 'high')
})

test('a tenant with no subscription is flagged', () => {
  assert.deepEqual(kinds(org({ subscription: null })), ['no_subscription'])
})

test('an expired trial and an expired subscription are distinct alerts', () => {
  const expiredTrial = kinds(org({
    subscription: {
      plan: 'trial', status: 'trialing', trialEndsAt: at(-2),
      currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelledAt: null,
    },
  }))
  const expiredSub = kinds(org({
    subscription: {
      plan: 'monthly', status: 'active', trialEndsAt: null,
      currentPeriodEnd: at(-2), cancelAtPeriodEnd: false, cancelledAt: null,
    },
  }))
  assert.deepEqual(expiredTrial, ['trial_expired'])
  assert.deepEqual(expiredSub, ['expired'])
})

test('an outright cancelled subscription is flagged', () => {
  assert.deepEqual(
    kinds(org({
      subscription: {
        plan: 'monthly', status: 'cancelled', trialEndsAt: null,
        currentPeriodEnd: at(-1), cancelAtPeriodEnd: false, cancelledAt: at(-1),
      },
    })),
    ['cancelled'],
  )
})

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

test('a trial inside the warning window is flagged, and escalates near the end', () => {
  const far = deriveOrgAlerts(org({
    subscription: {
      plan: 'trial', status: 'trialing', trialEndsAt: at(TRIAL_WARNING_DAYS),
      currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelledAt: null,
    },
  }), NOW)
  const near = deriveOrgAlerts(org({
    subscription: {
      plan: 'trial', status: 'trialing', trialEndsAt: at(2),
      currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelledAt: null,
    },
  }), NOW)

  assert.equal(far[0].kind, 'trial_ending')
  assert.equal(far[0].severity, 'medium')
  assert.equal(near[0].kind, 'trial_ending')
  assert.equal(near[0].severity, 'high', 'two days out should outrank seven')
})

test('a paid subscription ending soon is flagged with the remaining days', () => {
  const alerts = deriveOrgAlerts(org({
    subscription: {
      plan: 'monthly', status: 'active', trialEndsAt: null,
      currentPeriodEnd: at(5), cancelAtPeriodEnd: false, cancelledAt: null,
    },
  }), NOW)
  assert.equal(alerts[0].kind, 'subscription_ending')
  assert.equal(alerts[0].daysRemaining, 5)
  assert.ok(alerts[0].detail.includes('5 ditë'))
})

test('a scheduled cancellation is a separate alert from an ordinary renewal', () => {
  const cancelling = deriveOrgAlerts(org({
    subscription: {
      plan: 'monthly', status: 'active', trialEndsAt: null,
      currentPeriodEnd: at(40), cancelAtPeriodEnd: true, cancelledAt: at(-1),
    },
  }), NOW)

  assert.equal(cancelling[0].kind, 'cancellation_scheduled')
  assert.equal(cancelling[0].daysRemaining, 40)
  // Still 40 days out, so it is worth knowing but not urgent.
  assert.equal(cancelling[0].severity, 'medium')
})

test('a cancellation about to take effect is urgent', () => {
  const alerts = deriveOrgAlerts(org({
    subscription: {
      plan: 'monthly', status: 'active', trialEndsAt: null,
      currentPeriodEnd: at(RENEWAL_WARNING_DAYS - 1), cancelAtPeriodEnd: true, cancelledAt: at(-1),
    },
  }), NOW)
  assert.equal(alerts[0].kind, 'cancellation_scheduled')
  assert.equal(alerts[0].severity, 'high')
})

// ---------------------------------------------------------------------------
// Dormancy
// ---------------------------------------------------------------------------

test('a paying tenant that stopped selling is flagged as dormant', () => {
  const alerts = deriveOrgAlerts(org({ lastActivity: at(-(DORMANT_DAYS + 5)) }), NOW)
  assert.deepEqual(alerts.map((a) => a.kind), ['dormant'])
  assert.equal(alerts[0].severity, 'low')
})

test('a tenant that has never sold is flagged once it is old enough', () => {
  const alerts = deriveOrgAlerts(
    org({ lastActivity: null, createdAt: at(-(DORMANT_DAYS + 1)) }),
    NOW,
  )
  assert.equal(alerts[0].kind, 'dormant')
  assert.ok(alerts[0].title.includes('Asnjë shitje'))
})

test('a brand-new tenant with no sales is not dormant yet', () => {
  assert.deepEqual(kinds(org({ lastActivity: null, createdAt: at(-2) })), [])
})

test('a blocked tenant is not also reported as dormant', () => {
  // Its expiry already explains the silence; reporting both would count the
  // same customer problem twice in the queue.
  const alerts = deriveOrgAlerts(
    org({ lastActivity: at(-400), subscription: null }),
    NOW,
  )
  assert.deepEqual(alerts.map((a) => a.kind), ['no_subscription'])
})

// ---------------------------------------------------------------------------
// Portfolio ordering
// ---------------------------------------------------------------------------

test('the queue puts urgent items first and nearer deadlines above later ones', () => {
  const portfolio: AlertOrgInput[] = [
    org({ id: 1, name: 'Dormant',  lastActivity: at(-100) }),
    org({ id: 2, name: 'Suspended', isActive: false }),
    org({
      id: 3, name: 'Ends in 10',
      subscription: {
        plan: 'monthly', status: 'active', trialEndsAt: null,
        currentPeriodEnd: at(10), cancelAtPeriodEnd: false, cancelledAt: null,
      },
    }),
    org({
      id: 4, name: 'Ends in 2',
      subscription: {
        plan: 'monthly', status: 'active', trialEndsAt: null,
        currentPeriodEnd: at(2), cancelAtPeriodEnd: false, cancelledAt: null,
      },
    }),
  ]

  const queue = derivePlatformAlerts(portfolio, NOW)
  const names = queue.map((a) => a.organizationName)

  assert.equal(queue[0].severity, 'high')
  assert.equal(names[0], 'Ends in 2', 'the nearest high-severity deadline leads')
  assert.equal(
    names.indexOf('Suspended') > names.indexOf('Ends in 2'),
    true,
    'undated high-severity alerts sort after dated ones of the same severity',
  )
  assert.equal(names[names.length - 1], 'Dormant', 'low severity sorts last')
})

test('an empty portfolio produces an empty queue rather than throwing', () => {
  assert.deepEqual(derivePlatformAlerts([], NOW), [])
})

test('ISO date strings from the API behave identically to Date objects', () => {
  const fromDates = deriveOrgAlerts(org({ lastActivity: at(-100) }), NOW)
  const fromStrings = deriveOrgAlerts(
    org({ lastActivity: at(-100).toISOString(), createdAt: at(-200).toISOString() }),
    NOW,
  )
  assert.deepEqual(fromStrings.map((a) => a.kind), fromDates.map((a) => a.kind))
  assert.equal(fromStrings[0].detail, fromDates[0].detail)
})

test('every alert names its organization so the queue is actionable', () => {
  const queue = derivePlatformAlerts(
    [org({ id: 7, name: 'Market Shtatë', isActive: false })],
    NOW,
  )
  assert.equal(queue[0].organizationId, 7)
  assert.equal(queue[0].organizationName, 'Market Shtatë')
  assert.ok(queue[0].title.length > 0)
  assert.ok(queue[0].detail.length > 0)
})

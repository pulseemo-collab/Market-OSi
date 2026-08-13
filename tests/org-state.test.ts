/**
 * Organization lifecycle state resolution.
 *
 * The defect these cover: three independent facts — platform suspension,
 * subscription status and scheduled cancellation — were each rendered by
 * whichever screen happened to read them, so a customer who had cancelled
 * renewal appeared as an ordinary active tenant and a suspended tenant appeared
 * as nothing unusual at all.
 *
 * Every assertion pins an absolute instant so results do not depend on when the
 * suite runs.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveOrgState, formatOrgDate } from '../src/lib/org-state'

const NOW = new Date('2026-08-13T12:00:00.000Z')
const FUTURE = new Date('2026-09-12T12:00:00.000Z')
const PAST = new Date('2026-07-14T12:00:00.000Z')

function sub(over: Partial<{
  plan: string
  status: string
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  cancelledAt: Date | null
}> = {}) {
  return {
    plan: 'monthly',
    status: 'active',
    trialEndsAt: null,
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// The three states that were previously conflated
// ---------------------------------------------------------------------------

test('a paid, renewing subscription is active', () => {
  const s = resolveOrgState({ isActive: true, subscription: sub() }, NOW)
  assert.equal(s.kind, 'active')
  assert.equal(s.label, 'Aktiv')
  assert.equal(s.hasAccess, true)
  assert.equal(s.cancellationScheduled, false)
})

test('a customer cancellation inside the paid period keeps access and says so', () => {
  const s = resolveOrgState(
    { isActive: true, subscription: sub({ cancelAtPeriodEnd: true, cancelledAt: NOW }) },
    NOW,
  )
  assert.equal(s.kind, 'cancelling')
  assert.equal(s.label, 'Anuluar')
  assert.equal(s.hasAccess, true, 'the customer paid through the period end')
  assert.equal(s.cancellationScheduled, true)
  assert.equal(s.detail, 'Anuluar — aktiv deri më 12/09/2026')
  assert.deepEqual(s.effectiveUntil, FUTURE)
})

test('a scheduled cancellation is never reported as an ordinary active subscription', () => {
  const plain = resolveOrgState({ isActive: true, subscription: sub() }, NOW)
  const cancelling = resolveOrgState(
    { isActive: true, subscription: sub({ cancelAtPeriodEnd: true }) },
    NOW,
  )
  assert.notEqual(plain.kind, cancelling.kind)
  assert.notEqual(plain.label, cancelling.label)
  assert.notEqual(plain.color, cancelling.color)
})

test('platform suspension is distinct from every cancellation state', () => {
  const suspended = resolveOrgState({ isActive: false, subscription: sub() }, NOW)
  assert.equal(suspended.kind, 'suspended')
  assert.equal(suspended.label, 'Pezulluar')
  assert.equal(suspended.hasAccess, false)
  assert.equal(suspended.cancellationScheduled, false)

  const cancelled = resolveOrgState(
    { isActive: true, subscription: sub({ status: 'cancelled', cancelledAt: NOW }) },
    NOW,
  )
  assert.notEqual(suspended.kind, cancelled.kind)
  assert.equal(cancelled.kind, 'cancelled')
})

test('suspension outranks a fully paid subscription', () => {
  const s = resolveOrgState({ isActive: false, subscription: sub({ currentPeriodEnd: FUTURE }) }, NOW)
  assert.equal(s.kind, 'suspended')
  assert.equal(s.hasAccess, false, 'a suspended tenant is blocked even when paid up')
})

test('suspension is reported even when the tenant has no subscription row', () => {
  const s = resolveOrgState({ isActive: false, subscription: null }, NOW)
  assert.equal(s.kind, 'suspended')
})

// ---------------------------------------------------------------------------
// Trial
// ---------------------------------------------------------------------------

test('a running trial has access and shows its end date', () => {
  const s = resolveOrgState(
    { isActive: true, subscription: sub({ status: 'trialing', trialEndsAt: FUTURE, currentPeriodEnd: null }) },
    NOW,
  )
  assert.equal(s.kind, 'trialing')
  assert.equal(s.hasAccess, true)
  assert.equal(s.detail, 'Provë — aktiv deri më 12/09/2026')
})

test('an expired trial loses access and is not labelled the same as a running one', () => {
  const s = resolveOrgState(
    { isActive: true, subscription: sub({ status: 'trialing', trialEndsAt: PAST, currentPeriodEnd: null }) },
    NOW,
  )
  assert.equal(s.kind, 'trial_expired')
  assert.equal(s.hasAccess, false)
})

test('a trial with no end date never expires, matching the access check', () => {
  const s = resolveOrgState(
    { isActive: true, subscription: sub({ status: 'trialing', trialEndsAt: null, currentPeriodEnd: null }) },
    NOW,
  )
  assert.equal(s.kind, 'trialing')
  assert.equal(s.hasAccess, true)
})

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

test('an active subscription past its period end is expired', () => {
  const s = resolveOrgState({ isActive: true, subscription: sub({ currentPeriodEnd: PAST }) }, NOW)
  assert.equal(s.kind, 'expired')
  assert.equal(s.hasAccess, false)
})

test('a cancellation that has run past its period end no longer grants access', () => {
  const s = resolveOrgState(
    { isActive: true, subscription: sub({ currentPeriodEnd: PAST, cancelAtPeriodEnd: true, cancelledAt: PAST }) },
    NOW,
  )
  assert.equal(s.kind, 'expired')
  assert.equal(s.hasAccess, false, 'access follows the normal expiry rule once the paid period ends')
})

test('an outright cancelled subscription has no access', () => {
  const s = resolveOrgState(
    { isActive: true, subscription: sub({ status: 'cancelled', cancelledAt: NOW }) },
    NOW,
  )
  assert.equal(s.kind, 'cancelled')
  assert.equal(s.hasAccess, false)
})

test('a tenant with no subscription has no access', () => {
  const s = resolveOrgState({ isActive: true, subscription: null }, NOW)
  assert.equal(s.kind, 'no_subscription')
  assert.equal(s.hasAccess, false)
})

test('an unrecognised status fails closed rather than granting access', () => {
  const s = resolveOrgState({ isActive: true, subscription: sub({ status: 'something_new' }) }, NOW)
  assert.equal(s.hasAccess, false)
})

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

test('ISO strings from the API resolve identically to Date objects', () => {
  const fromDates = resolveOrgState({ isActive: true, subscription: sub({ cancelAtPeriodEnd: true }) }, NOW)
  const fromStrings = resolveOrgState(
    {
      isActive: true,
      subscription: {
        plan: 'monthly',
        status: 'active',
        trialEndsAt: null,
        currentPeriodEnd: FUTURE.toISOString(),
        cancelAtPeriodEnd: true,
        cancelledAt: null,
      },
    },
    NOW,
  )
  assert.equal(fromStrings.kind, fromDates.kind)
  assert.equal(fromStrings.detail, fromDates.detail)
})

test('every state carries a non-empty Albanian label and detail', () => {
  const inputs = [
    { isActive: false, subscription: sub() },
    { isActive: true, subscription: null },
    { isActive: true, subscription: sub({ status: 'trialing', trialEndsAt: FUTURE }) },
    { isActive: true, subscription: sub({ status: 'trialing', trialEndsAt: PAST }) },
    { isActive: true, subscription: sub({ cancelAtPeriodEnd: true }) },
    { isActive: true, subscription: sub() },
    { isActive: true, subscription: sub({ currentPeriodEnd: PAST }) },
    { isActive: true, subscription: sub({ status: 'cancelled' }) },
  ]
  const kinds = new Set<string>()
  for (const input of inputs) {
    const s = resolveOrgState(input, NOW)
    assert.ok(s.label.length > 0, 'label must not be empty')
    assert.ok(s.detail.length > 0, 'detail must not be empty')
    assert.ok(s.color.length > 0, 'color must not be empty')
    kinds.add(s.kind)
  }
  assert.equal(kinds.size, 8, 'the eight states must be distinguishable from one another')
})

test('dates render as DD/MM/YYYY and missing dates as a dash', () => {
  assert.equal(formatOrgDate(new Date('2026-09-12T12:00:00.000Z')), '12/09/2026')
  assert.equal(formatOrgDate(null), '—')
  assert.equal(formatOrgDate('not a date'), '—')
})

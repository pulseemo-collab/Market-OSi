/**
 * Business-day boundaries in the market's timezone.
 *
 * The defect these cover: day boundaries were built with `new Date(y, m, d)`,
 * which resolves against the server's timezone. Development runs in Albania and
 * Vercel runs in UTC, so a sale at 00:30 in Tirana was counted on the previous
 * business day once deployed and on the correct one in testing.
 *
 * Every assertion below states an absolute instant, so the expected value does
 * not depend on the machine running the test.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BUSINESS_TIMEZONE,
  businessDayKey,
  businessDayLabel,
  businessDayRange,
  businessMonthKey,
  businessParts,
  businessTimeToUtc,
  endOfBusinessDateExclusive,
  startOfBusinessDate,
  startOfBusinessDay,
  startOfBusinessDayOffset,
  startOfBusinessMonth,
} from '../src/lib/business-time'

const TZ = 'Europe/Tirane'

test('the configured business timezone is Albania', () => {
  assert.equal(BUSINESS_TIMEZONE, 'Europe/Tirane')
})

// ---------------------------------------------------------------------------
// The reported failure: a sale just after local midnight
// ---------------------------------------------------------------------------

test('a sale at 00:30 in Tirana belongs to the day that just started, not the previous one', () => {
  // 2026-08-13T22:30Z is 2026-08-14 00:30 in Tirana (UTC+2 in summer).
  const sale = new Date('2026-08-13T22:30:00.000Z')

  assert.equal(businessDayKey(sale, TZ), '2026-08-14')
  assert.equal(
    startOfBusinessDay(sale, TZ).toISOString(),
    '2026-08-13T22:00:00.000Z',
    'the business day opens at local midnight, which is 22:00Z in summer',
  )
})

test('that sale falls inside the day range and the previous day excludes it', () => {
  const sale = new Date('2026-08-13T22:30:00.000Z')
  const today = businessDayRange(sale, TZ)

  assert.ok(sale >= today.gte && sale < today.lt, 'inside its own business day')

  const yesterdayStart = startOfBusinessDayOffset(sale, -1, TZ)
  const yesterdayEnd = startOfBusinessDayOffset(yesterdayStart, 1, TZ)
  assert.ok(!(sale >= yesterdayStart && sale < yesterdayEnd), 'not in the previous business day')
})

test('the same instant under the old server-local arithmetic lands on the wrong day in UTC', () => {
  // Reproduces the defect rather than the fix: this is what the routes did.
  const sale = new Date('2026-08-13T22:30:00.000Z')
  const serverLocalDayStart = new Date(
    sale.getUTCFullYear(),
    sale.getUTCMonth(),
    sale.getUTCDate(),
  )

  // Under UTC the old boundary opens on 13 August, so the 14 August sale was
  // counted a day early. The business-timezone boundary does not.
  assert.notEqual(
    serverLocalDayStart.getUTCDate(),
    businessParts(startOfBusinessDay(sale, TZ), TZ).day,
  )
})

test('a sale at 23:30 local is still the same business day', () => {
  const sale = new Date('2026-08-13T21:30:00.000Z') // 23:30 on 13 Aug in Tirana
  assert.equal(businessDayKey(sale, TZ), '2026-08-13')
})

test('midnight exactly opens the new business day', () => {
  const midnight = new Date('2026-08-13T22:00:00.000Z')
  assert.equal(businessDayKey(midnight, TZ), '2026-08-14')
  assert.equal(startOfBusinessDay(midnight, TZ).getTime(), midnight.getTime())
})

test('one millisecond before midnight is still the closing day', () => {
  const justBefore = new Date('2026-08-13T21:59:59.999Z')
  assert.equal(businessDayKey(justBefore, TZ), '2026-08-13')
})

// ---------------------------------------------------------------------------
// Winter, when the offset is different
// ---------------------------------------------------------------------------

test('in winter the business day opens at 23:00Z, an hour later than in summer', () => {
  const sale = new Date('2026-01-14T23:30:00.000Z') // 00:30 on 15 Jan in Tirana (UTC+1)
  assert.equal(businessDayKey(sale, TZ), '2026-01-15')
  assert.equal(startOfBusinessDay(sale, TZ).toISOString(), '2026-01-14T23:00:00.000Z')
})

// ---------------------------------------------------------------------------
// DST transitions
// ---------------------------------------------------------------------------

test('the spring-forward day is 23 hours long and still advances by exactly one day', () => {
  // Europe/Tirane moves 02:00 → 03:00 on the last Sunday of March 2026 (29th).
  const dayStart = startOfBusinessDate('2026-03-29', TZ)!
  const nextStart = startOfBusinessDayOffset(dayStart, 1, TZ)

  assert.equal(dayStart.toISOString(), '2026-03-28T23:00:00.000Z')
  assert.equal(nextStart.toISOString(), '2026-03-29T22:00:00.000Z')

  const hours = (nextStart.getTime() - dayStart.getTime()) / 3_600_000
  assert.equal(hours, 23, 'the short day must not be treated as 24 hours')
  assert.equal(businessDayKey(nextStart, TZ), '2026-03-30')
})

test('the autumn fall-back day is 25 hours long and still advances by exactly one day', () => {
  // Clocks go back on the last Sunday of October 2026 (25th).
  const dayStart = startOfBusinessDate('2026-10-25', TZ)!
  const nextStart = startOfBusinessDayOffset(dayStart, 1, TZ)

  const hours = (nextStart.getTime() - dayStart.getTime()) / 3_600_000
  assert.equal(hours, 25, 'the long day must not be treated as 24 hours')
  assert.equal(businessDayKey(nextStart, TZ), '2026-10-26')
})

test('a sale during the repeated hour still belongs to the fall-back day', () => {
  // 02:30 local occurs twice on 25 Oct 2026; both instants are that same day.
  const firstPass = new Date('2026-10-25T00:30:00.000Z')
  const secondPass = new Date('2026-10-25T01:30:00.000Z')

  assert.equal(businessDayKey(firstPass, TZ), '2026-10-25')
  assert.equal(businessDayKey(secondPass, TZ), '2026-10-25')
})

test('stepping across a DST boundary a day at a time never skips or repeats a date', () => {
  let cursor = startOfBusinessDate('2026-03-27', TZ)!
  const seen: string[] = []

  for (let i = 0; i < 5; i++) {
    seen.push(businessDayKey(cursor, TZ))
    cursor = startOfBusinessDayOffset(cursor, 1, TZ)
  }

  assert.deepEqual(seen, ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31'])
})

// ---------------------------------------------------------------------------
// Month and period boundaries
// ---------------------------------------------------------------------------

test('a sale at 00:30 on the first of the month belongs to the new month', () => {
  const sale = new Date('2026-08-31T22:30:00.000Z') // 1 Sep 00:30 in Tirana
  const monthStart = startOfBusinessMonth(sale, 0, TZ)

  assert.equal(monthStart.toISOString(), '2026-08-31T22:00:00.000Z')
  assert.ok(sale >= monthStart, 'the sale is inside September, not August')
  assert.equal(businessMonthKey(sale, TZ).monthIndex, 8, 'September is index 8')
})

test('startOfBusinessMonth walks back whole calendar months, including across a year', () => {
  const now = new Date('2026-08-13T12:00:00.000Z')
  assert.equal(startOfBusinessMonth(now, 1, TZ).toISOString(), '2026-06-30T22:00:00.000Z')
  assert.equal(startOfBusinessMonth(now, 11, TZ).toISOString(), '2025-08-31T22:00:00.000Z')
})

test('day offsets roll across month and year ends', () => {
  const newYearEve = startOfBusinessDate('2025-12-31', TZ)!
  assert.equal(businessDayKey(startOfBusinessDayOffset(newYearEve, 1, TZ), TZ), '2026-01-01')
  assert.equal(businessDayKey(startOfBusinessDayOffset(newYearEve, -1, TZ), TZ), '2025-12-30')
})

// ---------------------------------------------------------------------------
// Parsing operator-supplied dates
// ---------------------------------------------------------------------------

test('a YYYY-MM-DD filter resolves to local midnight of that day', () => {
  assert.equal(startOfBusinessDate('2026-08-14', TZ)!.toISOString(), '2026-08-13T22:00:00.000Z')
})

test('an inclusive end date becomes an exclusive bound on the next day', () => {
  const end = endOfBusinessDateExclusive('2026-08-14', TZ)!
  assert.equal(end.toISOString(), '2026-08-14T22:00:00.000Z')

  const lastSaleOfTheDay = new Date('2026-08-14T21:59:00.000Z') // 23:59 local
  assert.ok(lastSaleOfTheDay < end, 'the final minute of the requested day is included')
})

test('malformed and impossible dates are rejected rather than silently filtered', () => {
  for (const bad of ['', 'yesterday', '2026-13-01', '2026-02-30', '14/08/2026', '2026-8-4']) {
    assert.equal(startOfBusinessDate(bad, TZ), null, `expected null for ${JSON.stringify(bad)}`)
    assert.equal(endOfBusinessDateExclusive(bad, TZ), null)
  }
})

// ---------------------------------------------------------------------------
// Chart labels
// ---------------------------------------------------------------------------

test('chart labels use the business day, so a post-midnight sale is not mislabelled', () => {
  assert.equal(businessDayLabel(new Date('2026-08-13T22:30:00.000Z'), TZ), '14/08')
  assert.equal(businessDayLabel(new Date('2026-08-13T21:30:00.000Z'), TZ), '13/08')
})

test('the result does not depend on the timezone the process was started in', () => {
  // businessParts never consults the system zone, so an instant formatted for
  // Tirana is the same whatever TZ the runtime has.
  const sale = new Date('2026-08-13T22:30:00.000Z')
  assert.equal(businessParts(sale, TZ).day, 14)
  assert.equal(businessParts(sale, 'UTC').day, 13)
  assert.equal(businessTimeToUtc(2026, 8, 14, 0, 0, 0, TZ).toISOString(), '2026-08-13T22:00:00.000Z')
  assert.equal(businessTimeToUtc(2026, 8, 14, 0, 0, 0, 'UTC').toISOString(), '2026-08-14T00:00:00.000Z')
})

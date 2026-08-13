/**
 * Business-day arithmetic in a fixed business timezone.
 *
 * A grocery's day is the day its staff worked, not the day the server happened
 * to be in. Those are different things: development runs in Albanian local time
 * and Vercel runs in UTC, so `new Date(y, m, d)` — the previous approach —
 * produced a different "today" in production than in testing. A sale rung up at
 * 00:30 in Tirana landed on the previous business day once deployed.
 *
 * Everything here resolves against `BUSINESS_TIMEZONE` explicitly, so the answer
 * is the same whatever `TZ` the runtime was started with. Nothing here reads the
 * server's local timezone, and no stored timestamp is rewritten — only the
 * boundaries used to group and filter them.
 *
 * Two properties the callers depend on:
 *
 *   1. Day boundaries are computed by calendar arithmetic, never by adding
 *      86 400 000 ms. On a DST transition the local day is 23 or 25 hours long,
 *      so "the next day" is a calendar question, not an arithmetic one.
 *   2. A local wall-clock time is converted to an instant by resolving the zone
 *      offset twice — once at the guessed instant and once at the candidate it
 *      produces. Near a transition those differ, and the second pass is what
 *      makes the result land on the intended side of it.
 */

/** Overridable so a deployment in another market does not need a code change. */
export const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE ?? 'Europe/Tirane'

export interface BusinessParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let existing = formatters.get(timeZone)
  if (!existing) {
    existing = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, existing)
  }
  return existing
}

/** Wall-clock fields an observer in `timeZone` would read off the clock. */
export function businessParts(
  instant: Date,
  timeZone: string = BUSINESS_TIMEZONE,
): BusinessParts {
  const parts = formatter(timeZone).formatToParts(instant)
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type)
    return found ? Number(found.value) : 0
  }

  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    // Some ICU builds render midnight as hour 24 rather than 0.
    hour: field('hour') % 24,
    minute: field('minute'),
    second: field('second'),
  }
}

/** The zone's UTC offset in milliseconds at a given instant. */
function offsetMs(timeZone: string, instant: Date): number {
  const p = businessParts(instant, timeZone)
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // formatToParts has no milliseconds, so compare against a truncated instant.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * The instant at which the given wall-clock time occurs in `timeZone`.
 *
 * Month and day values outside their normal range are normalised the way
 * `Date.UTC` normalises them, so `day + 1` past the end of a month and
 * `month - 12` are both well defined.
 */
export function businessTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone: string = BUSINESS_TIMEZONE,
): Date {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second)

  const firstPass = wallClock - offsetMs(timeZone, new Date(wallClock))
  const secondPass = wallClock - offsetMs(timeZone, new Date(firstPass))

  return new Date(secondPass)
}

/** Midnight opening the business day that `instant` falls in. */
export function startOfBusinessDay(
  instant: Date = new Date(),
  timeZone: string = BUSINESS_TIMEZONE,
): Date {
  const p = businessParts(instant, timeZone)
  return businessTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone)
}

/**
 * Midnight opening the business day `days` calendar days from `instant`'s.
 *
 * Negative values look backwards. Calendar arithmetic, so a 23- or 25-hour DST
 * day still advances by exactly one day.
 */
export function startOfBusinessDayOffset(
  instant: Date,
  days: number,
  timeZone: string = BUSINESS_TIMEZONE,
): Date {
  const p = businessParts(instant, timeZone)
  return businessTimeToUtc(p.year, p.month, p.day + days, 0, 0, 0, timeZone)
}

/** Midnight opening the first day of the month `monthsBack` before `instant`'s. */
export function startOfBusinessMonth(
  instant: Date = new Date(),
  monthsBack = 0,
  timeZone: string = BUSINESS_TIMEZONE,
): Date {
  const p = businessParts(instant, timeZone)
  return businessTimeToUtc(p.year, p.month - monthsBack, 1, 0, 0, 0, timeZone)
}

/** Half-open range `[start, end)` covering the business day `instant` is in. */
export function businessDayRange(
  instant: Date = new Date(),
  timeZone: string = BUSINESS_TIMEZONE,
): { gte: Date; lt: Date } {
  return {
    gte: startOfBusinessDay(instant, timeZone),
    lt: startOfBusinessDayOffset(instant, 1, timeZone),
  }
}

/**
 * Start of the business day named by a `YYYY-MM-DD` string.
 *
 * Returns null for anything that is not a calendar date, so a caller can reject
 * a malformed query parameter instead of filtering on `Invalid Date`.
 */
export function startOfBusinessDate(
  isoDate: string,
  timeZone: string = BUSINESS_TIMEZONE,
): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const resolved = businessTimeToUtc(year, month, day, 0, 0, 0, timeZone)
  // Rejects impossible dates such as 2026-02-30, which Date.UTC would roll over.
  const back = businessParts(resolved, timeZone)
  if (back.year !== year || back.month !== month || back.day !== day) return null

  return resolved
}

/** Start of the day AFTER the one named, for use as an exclusive upper bound. */
export function endOfBusinessDateExclusive(
  isoDate: string,
  timeZone: string = BUSINESS_TIMEZONE,
): Date | null {
  const start = startOfBusinessDate(isoDate, timeZone)
  if (!start) return null
  return startOfBusinessDayOffset(start, 1, timeZone)
}

/** `YYYY-MM-DD` for the business day an instant falls in. */
export function businessDayKey(
  instant: Date,
  timeZone: string = BUSINESS_TIMEZONE,
): string {
  const p = businessParts(instant, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** `DD/MM` chart label for the business day an instant falls in. */
export function businessDayLabel(
  instant: Date,
  timeZone: string = BUSINESS_TIMEZONE,
): string {
  const p = businessParts(instant, timeZone)
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}`
}

/** `YYYY-M` bucket key, with a zero-based month index matching `MONTH_NAMES`. */
export function businessMonthKey(
  instant: Date,
  timeZone: string = BUSINESS_TIMEZONE,
): { key: string; monthIndex: number; year: number } {
  const p = businessParts(instant, timeZone)
  return { key: `${p.year}-${p.month - 1}`, monthIndex: p.month - 1, year: p.year }
}

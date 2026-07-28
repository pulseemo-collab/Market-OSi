/**
 * Pagination parsing and safety limits for list endpoints.
 *
 * Existing clients fetch whole collections and receive bare arrays. Changing
 * that shape would break them, so pagination here is opt-in: a request that
 * sends no pagination parameters behaves exactly as before, except that an
 * absolute safety limit now caps how many rows a single request can pull out of
 * a shared multi-tenant table.
 *
 * Clients that do send `page` / `pageSize` get bounded pages plus
 * `X-Total-Count` and friends in the response headers.
 */

/** Largest page a client may request explicitly. */
export const MAX_PAGE_SIZE = 200

/** Ceiling applied to unpaginated reads so no single request can scan a whole table. */
export const DEFAULT_SAFETY_LIMIT = 5000

export interface PageRequest {
  /** True when the client explicitly asked for a page. */
  explicit: boolean
  page: number
  pageSize: number
  /** Prisma `take`. */
  take: number
  /** Prisma `skip`. */
  skip: number
}

export interface PageOptions {
  /** Page size used when the client sends `page` but no `pageSize`. */
  defaultPageSize?: number
  maxPageSize?: number
  /** Row ceiling for unpaginated requests. */
  safetyLimit?: number
}

function toPositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return parsed
}

/**
 * Reads `page` / `pageSize` (or the `limit` / `skip` aliases) and clamps them.
 */
export function parsePageRequest(
  searchParams: URLSearchParams,
  options: PageOptions = {},
): PageRequest {
  const {
    defaultPageSize = 50,
    maxPageSize = MAX_PAGE_SIZE,
    safetyLimit = DEFAULT_SAFETY_LIMIT,
  } = options

  const rawPage = searchParams.get('page')
  const rawPageSize = searchParams.get('pageSize') ?? searchParams.get('limit')
  const rawSkip = searchParams.get('skip')

  const explicit = rawPage !== null || rawPageSize !== null || rawSkip !== null

  if (!explicit) {
    return { explicit: false, page: 1, pageSize: safetyLimit, take: safetyLimit, skip: 0 }
  }

  const pageSize = Math.min(toPositiveInt(rawPageSize, defaultPageSize), maxPageSize)
  const page = toPositiveInt(rawPage, 1)

  // An explicit `skip` wins over `page`, which keeps the notification bell's
  // existing limit/skip contract working unchanged.
  const skip = rawSkip !== null ? Math.max(0, parseInt(rawSkip, 10) || 0) : (page - 1) * pageSize

  return { explicit: true, page, pageSize, take: pageSize, skip }
}

/** Pagination metadata headers. Safe to merge into any JSON response. */
export function paginationHeaders(request: PageRequest, total: number): Record<string, string> {
  return {
    'X-Total-Count': String(total),
    'X-Page': String(request.page),
    'X-Page-Size': String(request.pageSize),
    'X-Total-Pages': String(Math.max(1, Math.ceil(total / request.pageSize))),
  }
}

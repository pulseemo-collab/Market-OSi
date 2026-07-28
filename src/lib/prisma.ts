import { PrismaClient } from '@prisma/client'
import { recordQuery } from './metrics'
import { invalidateTags, orgTag, type CacheEntity } from './cache'

const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS ?? '1000')

const WRITE_ACTIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
])

/**
 * Models whose writes are scattered across many routes, mapped to the cache
 * entity their payloads are tagged with.
 *
 * Billing is the case that justifies this: subscription state gates access on
 * every business request, and self-service billing alone writes it from eight
 * places (cancel, undo-cancel, change-plan, close, top-up, plus the
 * platform-owner actions). Enforcing invalidation here means a plan change
 * always takes effect on the very next request, whichever route made it — no
 * call site can forget.
 *
 * Entity caches with few, well-localised writers (products, sales, suppliers,
 * supplies) invalidate explicitly in their route handlers instead, where the
 * relationship between the write and the affected payloads is visible.
 */
const WRITE_INVALIDATION: Record<string, CacheEntity> = {
  Subscription: 'subscription',
  BillingAuditLog: 'subscription',
}

/**
 * Pulls the tenant id out of a write's arguments.
 *
 * Both models above are addressed by organizationId in every write path, in
 * `where` for updates and deletes and in `data` for creates.
 */
function organizationIdFromArgs(args: unknown): number | null {
  if (typeof args !== 'object' || args === null) return null
  const { where, data } = args as { where?: unknown; data?: unknown }

  for (const source of [where, data]) {
    if (typeof source !== 'object' || source === null) continue
    const value = (source as { organizationId?: unknown }).organizationId
    if (typeof value === 'number') return value
  }
  return null
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function makePrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'error' },
    ],
  })

  client.$on('query', (e) => {
    if (e.duration >= SLOW_QUERY_MS) {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'warn',
          type: 'slow_query',
          durationMs: e.duration,
          query: e.query.slice(0, 300),
          params: e.params.slice(0, 100),
        }),
      )
    }
  })

  // Per-model timing. The `query` event above reports raw SQL duration without
  // telling us which model it belongs to; this wraps the operation instead, so
  // metrics can be attributed to `Sale.findMany`, `Product.count` and so on.
  client.$use(async (params, next) => {
    const startedAt = Date.now()
    try {
      const result = await next(params)

      const entity = params.model ? WRITE_INVALIDATION[params.model] : undefined
      if (entity && WRITE_ACTIONS.has(params.action)) {
        const organizationId = organizationIdFromArgs(params.args)
        if (organizationId !== null) {
          invalidateTags(orgTag(organizationId, entity))
        }
      }

      return result
    } finally {
      recordQuery(params.model ?? 'raw', params.action, Date.now() - startedAt)
    }
  })

  // Cast away the narrowed type — $on handler is bound inside this closure,
  // callers only need the standard PrismaClient interface.
  return client as unknown as PrismaClient
}

export const prisma = globalForPrisma.prisma ?? makePrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

'use client'

import { useCallback, useRef } from 'react'

/**
 * Supplies a stable `Idempotency-Key` for one logical write.
 *
 * The key is created on the first attempt and reused by every attempt after it
 * until `reset()` is called on success. That is what makes the server-side
 * protection actually work:
 *
 *   - Double click — both clicks send the same key, so the second one replays
 *     the first one's response instead of creating a second row.
 *   - Failed request the user retries — same key, so a write that silently
 *     succeeded before the connection dropped is not repeated.
 *   - Next, separate operation — `reset()` has run, so it gets a fresh key and
 *     is correctly treated as new work.
 *
 * A cashier ringing up two genuinely identical baskets in a row is therefore
 * never blocked: the first sale completes, resets the key, and the second gets
 * its own.
 */
export function useIdempotencyKey() {
  const keyRef = useRef<string | null>(null)

  const headers = useCallback((): Record<string, string> => {
    if (!keyRef.current) keyRef.current = newKey()
    return { 'Idempotency-Key': keyRef.current }
  }, [])

  /** Call after the operation succeeds so the next one starts a new key. */
  const reset = useCallback(() => {
    keyRef.current = null
  }, [])

  return { headers, reset }
}

function newKey(): string {
  // randomUUID is unavailable outside secure contexts, which a POS terminal on
  // a plain-HTTP local network can be. These keys only need to be unique, not
  // unguessable — they are already scoped to one user, org and route.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

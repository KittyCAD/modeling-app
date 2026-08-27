import { computed, signal } from '@preact/signals'
import type { FsOperationQueue } from '@src/contracts/fsOperations'
import { normalizePath } from '@src/lib/paths'

/** How long a write stays recognisable as ours. */
const WRITE_TOKEN_TTL = 5_000

/**
 * Serializes mutating filesystem work per path.
 *
 * Saves, renames, and deletes for one path run in submission order while
 * unrelated paths proceed in parallel. Without this, two debounced saves of the
 * same file can interleave and leave a half-written document — the kind of
 * corruption that is invisible until someone reopens the project.
 */
export function createFsOperationQueue(): FsOperationQueue {
  /** The tail of each path's chain. Awaiting it means waiting your turn. */
  const chains = new Map<string, Promise<unknown>>()
  const pending = signal(0)
  const ownWrites = new Map<string, { contentId: string; at: number }[]>()

  const prune = (key: string) => {
    const cutoff = Date.now() - WRITE_TOKEN_TTL
    const kept = (ownWrites.get(key) ?? []).filter((entry) => entry.at > cutoff)
    if (kept.length > 0) ownWrites.set(key, kept)
    else ownWrites.delete(key)
    return kept
  }

  return {
    pending: computed(() => pending.value),

    enqueue<T>(path: string, operation: () => Promise<T>): Promise<T> {
      const key = normalizePath(path)
      pending.value += 1

      // Chain onto whatever is already queued for this path. `catch` keeps one
      // failed operation from poisoning every later operation on the same path.
      const previous = chains.get(key) ?? Promise.resolve()
      const result = previous.then(operation, operation)

      chains.set(
        key,
        result.catch(() => undefined)
      )

      return result.finally(() => {
        pending.value -= 1
        // Drop the chain once it is idle, so the map does not grow with every
        // path ever touched.
        if (chains.get(key) === result || pending.value === 0) {
          void Promise.resolve().then(() => {
            if (pending.value === 0) chains.delete(key)
          })
        }
      })
    },

    recordWrite(path, contentId) {
      const key = normalizePath(path)
      const entries = prune(key)
      ownWrites.set(key, [...entries, { contentId, at: Date.now() }])
    },

    isOwnWrite(path, contentId) {
      return prune(normalizePath(path)).some(
        (entry) => entry.contentId === contentId
      )
    },
  }
}

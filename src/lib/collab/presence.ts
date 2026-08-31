import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import { composedChange } from '@src/lib/buffers/composedChange'

/** How long a write keeps somebody visibly "here". */
const DEFAULT_WINDOW_MS = 5_000

export interface PresenceEntry {
  /** Opaque collaborator id. */
  author: string
  at: number
}

export interface Presence {
  /**
   * Who wrote to which path recently, keyed by path.
   *
   * Recent rather than ever: presence answers "who is here now", and a list of
   * everybody who has ever touched a file is a different question with a
   * different answer.
   */
  readonly here: ReadonlySignal<ReadonlyMap<string, PresenceEntry>>
  /** Who wrote to one path recently, or null. */
  at(path: string): ReadonlySignal<PresenceEntry | null>
  /** Watch a buffer. Returns a disposer. */
  follow(path: string, buffer: FileBackedTextBuffer): () => void
  record(path: string, author: string): void
  dispose(): void
}

/**
 * Where the other collaborators are.
 *
 * Derived from the attributed change stream rather than from a separate presence
 * protocol, which is the payoff of every writer going through one dispatch
 * boundary with an author on it: there is nothing extra to send, and a writer
 * cannot be present without having actually done something.
 *
 * **Only what has landed.** The service says nothing about which file it is
 * about to touch, so presence before the first edit of a turn would be a guess —
 * and guessing filenames out of streamed prose is what `main` does. "Zookeeper is
 * working" comes from a conversation's status; *this* is only ever a fact.
 *
 * Session-lifetime and deliberately small: a path, who, and when.
 */
export function createPresence(
  options: { windowMs?: number; now?: () => number } = {}
): Presence {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const now = options.now ?? (() => Date.now())

  const entries = signal<ReadonlyMap<string, PresenceEntry>>(new Map())
  const disposers = new Map<string, () => void>()

  /*
   * Bumped on a timer so `here` goes stale on its own.
   *
   * Without it a caller would see somebody as present forever after their last
   * keystroke, since nothing else would invalidate the computed — presence that
   * only ever arrives is not presence.
   */
  const tick = signal(0)
  const timer = setInterval(() => {
    // Only when there is something to expire, so an idle project is not woken
    // once a second for nothing.
    if (entries.peek().size > 0) tick.value += 1
  }, 1_000)

  const fresh = computed<ReadonlyMap<string, PresenceEntry>>(() => {
    void tick.value
    const cutoff = now() - windowMs
    const kept = new Map<string, PresenceEntry>()
    for (const [path, entry] of entries.value) {
      if (entry.at > cutoff) kept.set(path, entry)
    }
    return kept
  })

  const record = (path: string, author: string) => {
    const next = new Map(entries.peek())
    next.set(path, { author, at: now() })
    entries.value = next
  }

  const stop = (path: string) => {
    disposers.get(path)?.()
    disposers.delete(path)
  }

  return {
    here: fresh,

    at(path) {
      return computed(() => fresh.value.get(path) ?? null)
    },

    follow(path, buffer) {
      // Replacing rather than adding: two subscriptions would record the same
      // write twice, which is harmless here but hides a leak.
      stop(path)

      const dispose = buffer.onChange((change) => {
        // Only somebody else's writes. The local user is not "present" to
        // themselves, and marking them so would put their own name in a panel
        // telling them who else is here.
        if (change.author === undefined) return
        if (composedChange(change) === null) return
        record(path, change.author)
      })

      disposers.set(path, dispose)
      return () => {
        if (disposers.get(path) === dispose) stop(path)
        else dispose()
      }
    },

    record,

    dispose() {
      clearInterval(timer)
      for (const path of [...disposers.keys()]) stop(path)
      entries.value = new Map()
    },
  }
}

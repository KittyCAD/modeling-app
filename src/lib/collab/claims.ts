import { type ReadonlySignal, computed, signal } from '@preact/signals'

export interface WriteClaims {
  /**
   * Take the write claim on a path, or find out somebody else has it.
   *
   * True when the caller may now write: either it just took the claim, or it
   * already held it. False means another writer holds it and this one must wait.
   * Re-claiming a path you already hold is deliberately not an error — a writer
   * sends several outputs per turn and each one asks again.
   */
  claim(path: string, holder: string): boolean
  /** Who holds the claim on a path, if anybody. */
  holder(path: string): string | null
  /** Give up one path, if this holder is the one holding it. */
  releasePath(path: string, holder: string): boolean
  /** Give up everything this holder has, at the end of its turn. */
  release(holder: string): readonly string[]
  /**
   * Every claim, for the UI.
   *
   * Reactive because the thing it renders is "Zookeeper (2) is waiting for
   * main.kcl", which has to stop being true the moment the first writer finishes.
   */
  readonly held: ReadonlySignal<ReadonlyMap<string, string>>
}

/**
 * At most one remote writer may be mid-turn on a file.
 *
 * **This is a correctness mechanism, not a courtesy**, and it took running two
 * writers to see why. Two writers rewriting the same *line* can fail to conflict,
 * because their minimal diffs need not overlap: `depth = 2` becoming
 * `depth = 22` diffs to an insertion at one offset, and becoming `depth = 33`
 * diffs to a replacement of the character before it. The ranges genuinely are
 * disjoint, so `rebaseEdits` rebases — correctly, by its own rules — and the file
 * ends up holding `depth = 332`.
 *
 * No amount of care in the rebase fixes that. Interval arithmetic cannot know
 * that two disjoint character edits are arguing about one statement, and widening
 * the conflict rule to catch it would report a conflict for every edit that lands
 * near another, including appending at the end of a file while somebody's caret
 * is there — which has to stay silent, because it is the most common remote edit
 * there is.
 *
 * So the claim is what keeps the second writer off a file the first is still
 * writing to. Concurrency is preserved where it matters: two writers on
 * *different* files never contend, which is the case that motivated having more
 * than one conversation at all.
 *
 * The claim is held for the duration of a turn rather than a single apply,
 * because a turn is the unit a writer reasons in — it sends several outputs, each
 * building on its own last one, and letting somebody else in between them is the
 * same hazard in slower motion.
 *
 * Deliberately not a lock: nothing blocks and nothing queues here. A refused
 * writer is told so and decides what to do. Blocking would put a socket handler
 * to sleep holding a claim of its own.
 *
 * **And what a refused writer must not do is retry the output it was holding.**
 * A claim buys time; it does not make stale output valid. The refused writer's
 * version was computed against a document the holder has since changed, and its
 * diff may well still be disjoint from the holder's — so replaying it once the
 * claim frees reproduces exactly the interleaving the claim prevented. The rule
 * is therefore: **being refused is an instruction to resync** — advance the
 * writer's view to the current content and re-derive, or ask the model again —
 * rather than a hint to try the same thing later. Both halves of this are pinned
 * down in `src/features/zookeeper/concurrentWriters.test.ts`.
 */
export function createWriteClaims(): WriteClaims {
  const claims = signal<ReadonlyMap<string, string>>(new Map())

  const set = (next: Map<string, string>) => {
    claims.value = next
  }

  return {
    claim(path, holder) {
      const current = claims.peek()
      const existing = current.get(path)
      if (existing === holder) return true
      if (existing !== undefined) return false

      const next = new Map(current)
      next.set(path, holder)
      set(next)
      return true
    },

    holder(path) {
      return claims.peek().get(path) ?? null
    },

    releasePath(path, holder) {
      const current = claims.peek()
      if (current.get(path) !== holder) return false

      const next = new Map(current)
      next.delete(path)
      set(next)
      return true
    },

    release(holder) {
      const current = claims.peek()
      const released: string[] = []
      const next = new Map(current)

      for (const [path, owner] of current) {
        if (owner !== holder) continue
        next.delete(path)
        released.push(path)
      }

      if (released.length > 0) set(next)
      return released
    },

    held: computed(() => claims.value),
  }
}

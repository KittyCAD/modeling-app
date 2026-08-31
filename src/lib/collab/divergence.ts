import { ChangeSet } from '@codemirror/state'

/**
 * How far our copy of a file has drifted from a remote writer's copy of it.
 *
 * This is the missing argument to `rebaseEdits`. A remote writer computes its edits
 * against its own document; we hold a different one, because the user has been
 * typing and because our earlier applications of its work were themselves
 * rebased. A
 * `ChangeSet` from the writer's document to ours is exactly what turns its
 * coordinates into ours, and its `length` is the writer's document length —
 * which is the invariant `rebaseEdits` checks.
 *
 * **Why this and not "everything since the baseline, minus that writer's own
 * changes".** That was the obvious design and it does not work. Composing a
 * subset of a sequence of changes is not a matter of skipping entries: each entry
 * is expressed in the document the previous one produced, so dropping one leaves
 * the rest describing positions in a document that never existed. Recovering the
 * kept subset means transposing every excluded change out of the ones that follow
 * it, which needs the intermediate documents materialised and inverted. Tracking
 * the divergence forward instead needs neither, and reduces to two rules.
 *
 * Both rules are consequences of one identity, which CodeMirror documents on
 * `ChangeSet.map`: `A.compose(B.map(A))` and `B.compose(A.map(B, true))` produce
 * the same document.
 *
 * - A **local** change `U` happened to our document, which is where the
 *   divergence already ends. So it extends it: `divergence.compose(U)`.
 * - A **remote** edit `A`, in the writer's coordinates, moves the *start* of the
 *   divergence. `divergence.map(A)` re-expresses the drift against the writer's
 *   new document. Taking `A` rather than the rebased edit we actually dispatched
 *   is the part that is easy to get backwards: `A` is what moved the writer's
 *   document, and that is what the divergence is measured from.
 */
export interface DivergenceLedger {
  /**
   * Start tracking a path, with our document and the writer's believed identical.
   *
   * Called when a writer's view of a file is first known. `length` is that
   * document's length, in the coordinates the writer will answer in.
   */
  begin(path: string, length: number): void
  /**
   * A change somebody else made to our document — typing, a command, a reconcile.
   *
   * Returns false, changing nothing, when `changes` does not start from the
   * document the divergence currently ends at. See `recordRemote` for why that is
   * reported rather than ignored.
   */
  recordLocal(path: string, changes: ChangeSet): boolean
  /**
   * A remote edit that has been applied, in the **writer's** coordinates.
   *
   * That is the pre-rebase edit, as it arrived — not the mapped one that was
   * dispatched.
   *
   * Returns false, changing nothing, when `changes` does not start from the
   * writer's document as the divergence understands it. The check exists because
   * the way a caller gets this wrong is to record an edit it did not actually
   * apply, or to apply one it did not record — and without the check the ledger
   * accepts it, stays a plausible length, and every later rebase for that path is
   * measured against a document nobody has. Nothing throws and the file just
   * quietly gains text in the wrong place, which is the failure this whole design
   * exists to make impossible.
   */
  recordRemote(path: string, changes: ChangeSet): boolean
  /**
   * The drift for a path, or null when it is untracked or has none.
   *
   * Feed this straight to `rebaseEdits` as `local`.
   */
  divergence(path: string): ChangeSet | null
  /** Whether a path is being tracked at all. */
  tracks(path: string): boolean
  forget(path: string): void
  clear(): void
}

export function createDivergenceLedger(): DivergenceLedger {
  const drift = new Map<string, ChangeSet>()

  return {
    begin(path, length) {
      drift.set(path, ChangeSet.empty(length))
    },

    recordLocal(path, changes) {
      const current = drift.get(path)
      /*
       * An untracked path is one no writer has a known view of, so there is no
       * divergence to speak of and nothing to accumulate. That is not misuse —
       * it keeps the caller from having to know which files a turn touched
       * before it can forward a buffer change — so it reports success.
       */
      if (current === undefined) return true
      if (changes.empty) return true
      // A local change applies to our document, which is where the drift ends.
      if (changes.length !== current.newLength) return false
      drift.set(path, current.compose(changes))
      return true
    },

    recordRemote(path, changes) {
      const current = drift.get(path)
      if (current === undefined) return true
      if (changes.empty) return true
      // A remote edit applies to the writer's document, where the drift starts.
      if (changes.length !== current.length) return false
      /*
       * `before: true` is not decoration, and getting it wrong is invisible until
       * the writer and the user insert at the *same* offset — which is common,
       * since both like the end of the file.
       *
       * The identity has two sides, and the two mappings here have to sit on
       * opposite ones or they describe different documents. `rebaseEdits` maps the
       * remote edit with the default flag, which orders it *after* a local
       * insertion at the same point — the user's text was already there, so the
       * arriving text follows it. That fixes this side: the local change
       * must be ordered *before* the remote one, which is what `true` says. Flip
       * either one alone and the divergence stops describing our document, so
       * every later rebase for that path is measured against a document nobody
       * has. `divergence.properties.test.ts` asserts the round trip that catches
       * it.
       */
      drift.set(path, current.map(changes, true))
      return true
    },

    divergence(path) {
      const current = drift.get(path)
      if (current === undefined || current.empty) return null
      return current
    },

    tracks(path) {
      return drift.has(path)
    },

    forget(path) {
      drift.delete(path)
    },

    clear() {
      drift.clear()
    },
  }
}

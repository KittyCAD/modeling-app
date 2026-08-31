import { type ChangeDesc, ChangeSet } from '@codemirror/state'
import type { TextEdit } from '@src/contracts/modelingOperations'

/**
 * Whether any of `changes` modifies text strictly inside `[from, to)`.
 *
 * The predicate `classify` uses for a replacement, exposed because reverting a
 * turn asks the same question of a different range: "has anyone edited inside the
 * text the agent inserted?" Touching an endpoint does not count, for the reason
 * spelled out in `detectConflict` — `ChangeDesc.touchesRange` counts it, and that
 * makes the most common agent edit look like a conflict.
 */
export function changesTouchInterior(
  changes: ChangeDesc,
  from: number,
  to: number
): boolean {
  let found = false

  changes.iterChangedRanges((fromA, toA) => {
    if (found) return
    if (fromA < toA) {
      // A replacement or deletion: genuine overlap of half-open intervals.
      if (toA > from && fromA < to) found = true
      return
    }
    // A pure insertion: only strictly inside counts.
    if (fromA > from && fromA < to) found = true
  })

  return found
}

/**
 * Why an agent's edit could not be applied to the document as it now stands.
 *
 * Both are situations where no automated answer exists, rather than places the
 * algorithm gave up: the agent expressed an intent against text the user has
 * since made a different decision about.
 */
export type ConflictReason =
  /** The user edited text inside the span the agent meant to replace. */
  | 'overlapping'
  /** The text the agent meant to change is no longer there at all. */
  | 'erased'
  /**
   * The edit and the history it was rebased against describe different files.
   *
   * A caller error rather than anything the user did, but it arrives as a
   * conflict for a practical reason: this runs mid-stream while a turn applies,
   * so throwing would surface as an unhandled rejection somewhere up the socket
   * handler, while a conflict is a state the UI already knows how to show. It
   * also fails closed — nothing is written.
   */
  | 'baselineMismatch'

export type RebaseOutcome =
  /** The document has not moved. Apply verbatim. */
  | { kind: 'clean'; edits: readonly TextEdit[] }
  /** The document moved elsewhere. These offsets are against it as it is now. */
  | { kind: 'rebased'; edits: readonly TextEdit[] }
  /**
   * Ask the user. `edits` stay in *baseline* coordinates, because that is the
   * only document they are meaningful against — a conflict UI offering "use
   * Zookeeper's version" needs the edit as the agent meant it, not a mapped
   * approximation.
   */
  | { kind: 'conflict'; reason: ConflictReason; edits: readonly TextEdit[] }

/**
 * Move an agent's edit onto the document the user actually has now.
 *
 * The agent computes against a baseline captured when the turn was sent. Under
 * live-apply the user keeps typing while it thinks, so by the time an edit
 * arrives the document has usually moved. Rebasing is therefore not a fallback
 * for an unlucky case; it is the normal path, and it is the whole reason the edit
 * is recovered as positions rather than applied as a whole file. A whole-file
 * write has no positions, so there is nothing to map and "rebase" is not merely
 * harder but undefined.
 *
 * `local` is what happened to this file since the baseline, composed — and it
 * must exclude the agent's *own* earlier applications in the same turn, or the
 * second edit of a turn is rebased over the first and lands twice. The ledger
 * that produces it does that filtering; this function trusts it.
 *
 * The mechanism is CodeMirror's, not ours. `ChangeSet.map` is documented as "a
 * basic form of operational transformation … can be used for collaborative
 * editing", which is precisely the problem: two writers, one document, edits
 * computed against a shared ancestor. Treating the agent as a collaborator means
 * the primitive already shipped.
 */
export function rebaseEdits(input: {
  edits: readonly TextEdit[]
  /** Length of the file as the agent saw it. */
  baselineLength: number
  /** Composed local changes since the baseline. Null when the file is untouched. */
  local: ChangeSet | null
}): RebaseOutcome {
  const { edits, baselineLength, local } = input

  if (edits.length === 0) return { kind: 'clean', edits }
  if (local === null || local.empty) return { kind: 'clean', edits }

  /*
   * A `ChangeSet`'s `length` is the document it starts from. If that disagrees
   * with the baseline then the caller has paired an edit with the wrong file's
   * history, and every offset below would be measured against a document neither
   * party ever saw. Silently producing a defensible-looking result is the exact
   * failure this design exists to prevent, so refuse instead.
   */
  if (local.length !== baselineLength) {
    return { kind: 'conflict', reason: 'baselineMismatch', edits }
  }

  const conflict = detectConflict(edits, local)
  if (conflict !== null) return { kind: 'conflict', reason: conflict, edits }

  const mapped = ChangeSet.of(
    edits.map(({ from, to, insert }) => ({ from, to, insert })),
    baselineLength
  ).map(local)

  return { kind: 'rebased', edits: toTextEdits(mapped) }
}

/**
 * Decide whether the user's changes and the agent's can coexist.
 *
 * Detection runs in **baseline coordinates**, against the edit as the agent
 * wrote it. Mapping happens afterwards, only for survivors — inverting that
 * order destroys the evidence, because a mapped range no longer records what the
 * agent was talking about.
 *
 * `ChangeDesc.touchesRange` looks like the tool for this and is not. Its test is
 * `pos <= to && end >= from`, so a local change that merely *abuts* the agent's
 * range counts as touching it, and two insertions at one point count as
 * touching. Appending at the end of a file while the user's caret is also at the
 * end is the single most common agent edit there is; reporting that as a conflict
 * would make the feature unusable. `"cover"` is likewise incomplete — it is only
 * returned on strict containment (`pos < from && end > to`), so a local change
 * deleting *exactly* the agent's range reports `true` rather than `"cover"`.
 *
 * So the ranges are examined directly. `iterChangedRanges` reports `fromA`/`toA`
 * in the starting document, which is the baseline — the same coordinates the
 * agent's edits are in, with no conversion.
 */
function detectConflict(
  edits: readonly TextEdit[],
  local: ChangeSet
): ConflictReason | null {
  let reason: ConflictReason | null = null

  local.iterChangedRanges((fromA, toA) => {
    // An earlier range already settled it. `iterChangedRanges` has no way to
    // stop, and `erased` outranks `overlapping`, so only upgrade.
    if (reason === 'erased') return

    for (const edit of edits) {
      const found = classify(edit, fromA, toA)
      if (found === 'erased') {
        reason = 'erased'
        return
      }
      if (found === 'overlapping') reason = 'overlapping'
    }
  })

  return reason
}

/**
 * How one local changed range bears on one of the agent's edits.
 *
 * The two cases are genuinely different and collapsing them is what produces
 * false conflicts:
 *
 * - The agent **inserting** at a point only cares whether the point still
 *   exists. Text arriving beside it, on either side, is not a disagreement —
 *   `mergeTextEdits` says the same thing about the modelling path: "two inserts
 *   at the same offset are ordered, not conflicting".
 * - The agent **replacing** a span cares about that span's interior. A local
 *   change at either boundary maps cleanly, because the replacement's `from` is
 *   mapped forward and its `to` backward, so the range shrinks away from text the
 *   user typed at its edges rather than swallowing it.
 */
function classify(
  edit: TextEdit,
  fromA: number,
  toA: number
): ConflictReason | null {
  const agentInserts = edit.from === edit.to
  const localDeletes = fromA < toA

  if (agentInserts) {
    // Only a deletion strictly spanning the insertion point removes it. A
    // deletion ending exactly at the point, or starting there, leaves an
    // unambiguous place for the text to go.
    return localDeletes && fromA < edit.from && toA > edit.from
      ? 'erased'
      : null
  }

  if (!localDeletes) {
    // A local insertion, which deletes nothing. It only matters if it landed
    // strictly inside the span being replaced, where the agent's replacement
    // would swallow text the user just typed.
    return fromA > edit.from && fromA < edit.to ? 'overlapping' : null
  }

  // Half-open intervals: touching at an endpoint is not overlapping.
  const overlaps = toA > edit.from && fromA < edit.to
  if (!overlaps) return null

  return fromA <= edit.from && toA >= edit.to ? 'erased' : 'overlapping'
}

/**
 * Read a `ChangeSet` back out as edits against the document it applies to.
 *
 * `fromA`/`toA` are in that set's starting document, and a mapped set starts
 * from the current document — so these offsets are already the ones a dispatch
 * needs, with nothing further to convert.
 */
function toTextEdits(changes: ChangeSet): readonly TextEdit[] {
  const edits: TextEdit[] = []

  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({ from: fromA, to: toA, insert: inserted.toString() })
  })

  return edits
}

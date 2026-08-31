import type { ChangeSet, Text } from '@codemirror/state'
import { changesTouchInterior } from '@src/lib/collab/rebase'

/**
 * One change that has been applied to our document.
 *
 * Recorded for every writer, not just the one being undone, because removing a
 * contribution means projecting its inverse *through* everything that happened
 * afterwards — so the entries in between are as necessary as the ones being
 * reverted.
 *
 * `docBefore` is a CodeMirror `Text`, which is persistent, so holding one per
 * entry costs a pointer rather than a copy of the file.
 */
export interface AppliedChange {
  changes: ChangeSet
  /** Our document immediately before `changes` applied. */
  docBefore: Text
  /**
   * What this change belongs to, or null for the local user.
   *
   * A *contribution* is any set of changes worth undoing together. For an agent
   * that is one turn; for a remote human it might be one batch, or everything
   * they did while connected. This layer does not care which — it only needs the
   * tag to be stable.
   */
  contributionId: string | null
}

/**
 * A range of a contribution's text that somebody else has since edited inside.
 *
 * Offsets are in the document as it stood when that change landed, which is where
 * the range is meaningful — it describes a block the contributor wrote.
 */
export interface StrandedRange {
  from: number
  to: number
}

export interface ContributionInverse {
  /**
   * Applicable to the document as it now stands, or null when the contribution
   * changed nothing here.
   */
  changes: ChangeSet | null
  /**
   * Places where somebody else typed *inside* a block this contribution wrote.
   *
   * **Reverting does not delete that text.** Mapping a deletion over an insertion
   * that sits inside it preserves the insertion — standard operational-transform
   * behaviour, and the right behaviour: undoing one collaborator's work has no
   * business destroying another's. What it does instead is leave the text
   * stranded, without the surrounding lines that gave it meaning.
   *
   * So this is a warning about a mess, not about data loss: "reverting will leave
   * 2 fragments you typed behind". That is a materially different sentence from
   * the one this was first designed to show, and the difference was only visible
   * once the revert was actually run — see `revert.test.ts`.
   */
  stranded: readonly StrandedRange[]
}

/**
 * Undo one contributor's work, keeping everything that happened since.
 *
 * The counterpart to `rebaseEdits`, and deliberately the same two functions used
 * the other way round — which is the strongest evidence available that the model
 * is the right one. For a change `A` that took `D0` to `D1`, followed by later
 * changes `L`:
 *
 * - `A.invert(D0)` is a change from `D1` back to `D0`.
 * - It and `L` therefore **both start at `D1`**, which is exactly `map`'s stated
 *   precondition.
 * - So `A.invert(D0).map(L)` applies to the current document and removes `A`'s
 *   contribution while leaving `L`'s intact.
 *
 * This is why "restore the file to a snapshot" is the wrong primitive for a
 * shared document: it cannot distinguish whose work it is discarding.
 *
 * A contribution usually lands as several changes — an agent applies each streamed
 * output as it arrives, and a remote editor sends batches — so they are undone
 * newest-first, each projected forward through everything that followed it and
 * then composed onto the accumulating revert, using the composition CodeMirror
 * documents as `A.compose(B.map(A)) == B.compose(A.map(B, true))`.
 */
export function inverseForContribution(input: {
  applied: readonly AppliedChange[]
  contributionId: string
}): ContributionInverse {
  const { applied, contributionId } = input

  const mine: number[] = []
  for (let at = 0; at < applied.length; at += 1) {
    if (
      applied[at].contributionId === contributionId &&
      !applied[at].changes.empty
    ) {
      mine.push(at)
    }
  }

  if (mine.length === 0) return { changes: null, stranded: [] }

  let revert: ChangeSet | null = null

  for (let step = mine.length - 1; step >= 0; step -= 1) {
    const at = mine[step]
    const entry = applied[at]

    // From the document this entry produced, back to the one it started from.
    const inverse = entry.changes.invert(entry.docBefore)

    // From the document this entry produced, to the document we have now.
    const tail = composeRange(applied, at + 1)

    // Both start at the document the entry produced, so this maps cleanly.
    const toNow = tail === null ? inverse : inverse.map(tail)

    revert = revert === null ? toNow : revert.compose(toNow.map(revert))
  }

  return {
    changes: revert,
    stranded: strandedFor(applied, mine, contributionId),
  }
}

/**
 * Everything from `start` onwards, composed.
 *
 * Sequential by construction — each entry applies to the document the previous
 * one produced — so this is a plain fold with no mapping.
 */
function composeRange(
  applied: readonly AppliedChange[],
  start: number
): ChangeSet | null {
  let composed: ChangeSet | null = null

  for (let at = start; at < applied.length; at += 1) {
    if (applied[at].changes.empty) continue
    composed =
      composed === null
        ? applied[at].changes
        : composed.compose(applied[at].changes)
  }

  return composed
}

/**
 * Find where somebody else has edited inside text this contribution inserted.
 *
 * Walks each insertion forward one entry at a time rather than composing
 * everything first, because the question is asked *per entry*: a later change by
 * the same contribution strands nothing, so the entries have to stay
 * distinguishable, and they stop being so once composed together.
 */
function strandedFor(
  applied: readonly AppliedChange[],
  mine: readonly number[],
  contributionId: string
): readonly StrandedRange[] {
  const found: StrandedRange[] = []

  for (const at of mine) {
    // Where this entry's insertions ended up in the document it produced.
    let ranges: StrandedRange[] = []
    applied[at].changes.iterChanges((_fromA, _toA, fromB, toB) => {
      if (toB > fromB) ranges.push({ from: fromB, to: toB })
    })
    if (ranges.length === 0) continue

    for (
      let next = at + 1;
      next < applied.length && ranges.length > 0;
      next += 1
    ) {
      const entry = applied[next]
      if (entry.changes.empty) continue

      if (entry.contributionId !== contributionId) {
        for (const range of ranges) {
          if (changesTouchInterior(entry.changes, range.from, range.to)) {
            found.push(range)
          }
        }
      }

      // Carry the surviving ranges into the next document's coordinates.
      ranges = ranges
        .map((range) => ({
          from: entry.changes.mapPos(range.from, 1),
          to: entry.changes.mapPos(range.to, -1),
        }))
        .filter((range) => range.to > range.from)
    }
  }

  return dedupe(found)
}

/**
 * The same range can be reported once per intervening edit, and somebody told
 * "this leaves 3 fragments behind" does not want them counted twice.
 */
function dedupe(ranges: readonly StrandedRange[]): readonly StrandedRange[] {
  const seen = new Set<string>()
  const unique: StrandedRange[] = []

  for (const range of ranges) {
    const key = `${range.from}:${range.to}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(range)
  }

  return unique
}

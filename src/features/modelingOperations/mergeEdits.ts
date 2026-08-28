import type { TextEdit } from '@src/contracts/modelingOperations'

/**
 * Combine edits that were all measured against the same document.
 *
 * Every offset in a `ProjectEdit` is against the *original* source, and
 * everything is applied in one transaction — which is what lets a resolver's
 * prerequisite (naming a segment at offset 120) and an operation's own statement
 * (appended at the end) compose with no position mapping, and land as one undo
 * entry. That invariant is the reason this can be a sort and not a rewrite.
 *
 * Two things have to be handled, and both only appear once more than one
 * resolver contributes:
 *
 * - **Duplicates.** Two arguments needing the same segment named would each ask
 *   for the same insertion. Identical edits collapse to one.
 * - **Overlaps.** Anything else touching the same span is a genuine conflict, and
 *   CodeMirror rejects it with a message about ranges rather than about
 *   modelling. Better to say what actually happened.
 */
export function mergeTextEdits(
  edits: readonly TextEdit[]
): readonly TextEdit[] {
  const seen = new Set<string>()
  const unique: TextEdit[] = []

  for (const edit of edits) {
    const key = `${edit.from}:${edit.to}:${edit.insert}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(edit)
  }

  const sorted = [...unique].sort((a, b) => a.from - b.from || a.to - b.to)

  for (let at = 1; at < sorted.length; at += 1) {
    const previous = sorted[at - 1]
    const current = sorted[at]

    // Touching at a point is fine — two inserts at the same offset are ordered,
    // not conflicting. Overlapping a replaced span is not.
    if (current.from < previous.to) {
      throw new Error(
        `Two changes cover the same text (${previous.from}–${previous.to} and ${current.from}–${current.to}).`
      )
    }
  }

  return sorted
}

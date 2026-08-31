import { diffLines } from 'diff'
import type { TextEdit } from '@src/contracts/modelingOperations'
import { textDiff } from '@src/lib/buffers/textDiff'

/**
 * The edit that turns one version of a file into another, for an agent.
 *
 * Zookeeper answers with whole files, exactly as KCL's sketch frontend does, so
 * the same rule applies: recover a buffer edit rather than replacing the
 * document. `textDiff` explains why in four ways — the cursor jumps to the top,
 * every change becomes one undo entry covering everything, the language server
 * re-analyses a file it was told changed entirely, and anything watching for
 * *what* changed learns nothing.
 *
 * What is different here is the shape of the change. A sketch mutation rewrites
 * one region, so `textDiff`'s single replacement from the first difference to
 * the last is not just adequate but optimal. An agent edits *prose-shaped* code:
 * it will happily adjust `@settings` on line 1 and append a function at line 90
 * in the same turn, and the smallest span covering both is the whole file. That
 * is a full replacement wearing a diff's clothes, and it brings back all four
 * problems.
 *
 * So this escalates. `textDiff` first, because it is exact, allocation-free and
 * right most of the time; a real line diff only when the cheap answer has become
 * indistinguishable from giving up.
 *
 * **Lines, not words or characters.** KCL is line-oriented, and every consumer
 * downstream — the engine, the language server, diagnostics, the attribution
 * gutter — thinks in ranges over lines. A word diff of generated code yields
 * dozens of micro-edits that buy nothing (the undo entry is one transaction
 * either way) and make per-author gutter marks unreadable. It will also cheerfully
 * split the inside of a string literal.
 *
 * This lives here rather than in `src/lib/buffers/textDiff.ts` on purpose:
 * `textDiff` states that it "is not a diff algorithm and does not try to be", and
 * sketch mode depends on that being true. Compose, do not widen. If a third
 * caller ever wants this, promote it then.
 */
export function lineDiffEdits(
  before: string,
  after: string
): readonly TextEdit[] {
  const coarse = textDiff(before, after)
  if (coarse.length === 0) return coarse
  if (!worthEscalating(coarse[0], before.length)) return coarse

  return lineEdits(before, after)
}

/**
 * How much of the file a single replacement has to cover before a real diff is
 * worth its cost.
 *
 * Two conditions, and both are needed. The ratio is the actual signal: a span
 * covering most of the document is the case this exists to catch. The absolute
 * floor keeps small files out of it — rewriting eight of a ten-line file is 80%
 * of it and still one honest replacement, and running a line diff to discover
 * that wastes the work and can only produce more edits describing the same
 * change.
 */
const ESCALATE_ABOVE_FRACTION = 0.4
const ESCALATE_ABOVE_CHARS = 300

function worthEscalating(coarse: TextEdit, beforeLength: number): boolean {
  const replaced = Math.max(coarse.to - coarse.from, coarse.insert.length)
  if (replaced <= ESCALATE_ABOVE_CHARS) return false

  // A file that was empty has no ratio to speak of, and an insertion into one is
  // a single append however long it is.
  if (beforeLength === 0) return false

  return replaced / beforeLength > ESCALATE_ABOVE_FRACTION
}

/**
 * Walk a line diff into edits measured against `before`.
 *
 * Every offset is against the original document, which is what lets the result
 * go into one transaction with no position mapping and land as one undo entry —
 * the invariant `mergeTextEdits` documents and relies on.
 *
 * Runs of added and removed parts are gathered together rather than emitted
 * separately, so a changed line arrives as one replacement instead of a delete
 * touching a range and an insert at its edge. That matters beyond tidiness: two
 * edits abutting at a point are legal but describe the change less honestly, and
 * the attribution gutter would draw two marks where the agent made one change.
 */
function lineEdits(before: string, after: string): readonly TextEdit[] {
  const parts = diffLines(before, after)
  const edits: TextEdit[] = []

  // Advances only over text that exists in `before`: unchanged and removed parts
  // consume it, added parts do not.
  let offset = 0
  let at = 0

  while (at < parts.length) {
    if (!parts[at].added && !parts[at].removed) {
      offset += parts[at].value.length
      at += 1
      continue
    }

    let removed = ''
    let inserted = ''
    while (at < parts.length && (parts[at].added || parts[at].removed)) {
      if (parts[at].removed) removed += parts[at].value
      else inserted += parts[at].value
      at += 1
    }

    // A run that removes exactly what it adds is not a change. `diffLines` can
    // produce one when a token compares equal without being identical.
    if (removed !== inserted) {
      edits.push({
        from: offset,
        to: offset + removed.length,
        insert: inserted,
      })
    }
    offset += removed.length
  }

  return edits
}

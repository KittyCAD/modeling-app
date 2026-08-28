import type { TextEdit } from '@src/contracts/modelingOperations'

/**
 * The smallest edit that turns one text into another.
 *
 * KCL's frontend answers every sketch mutation with the *whole* file — the type
 * is called `SourceDelta` but it carries `text`, not a delta. Applying that as a
 * full replacement would work and would be wrong in four ways at once: the
 * cursor jumps to the top, every mutation is one undo entry covering the whole
 * document, the language server re-analyses a file it was told changed entirely,
 * and anything watching for *what* changed learns nothing.
 *
 * So the change is recovered instead. Trimming the common prefix and suffix is
 * not a diff algorithm and does not try to be: a sketch mutation rewrites one
 * region of one file, and the shortest edit that explains it is a single
 * replacement. A real diff would find two edits where this finds one only when
 * the change is genuinely scattered, which for generated KCL means the whole
 * block moved — and one replacement is the right answer there too.
 */
export function textDiff(before: string, after: string): readonly TextEdit[] {
  if (before === after) return []

  const limit = Math.min(before.length, after.length)

  let prefix = 0
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1

  /*
   * The suffix stops where the prefix already claimed. Without that guard the
   * two overlap for a change that repeats text — "ab" to "aab" would take one
   * character from each end of a one-character insertion and produce a negative
   * range.
   */
  let suffix = 0
  while (
    suffix < limit - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return [
    {
      from: prefix,
      to: before.length - suffix,
      insert: after.slice(prefix, after.length - suffix),
    },
  ]
}

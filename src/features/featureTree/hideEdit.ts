import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { TextEdit } from '@src/contracts/modelingOperations'
import { sourceRangeToUtf16 } from '@src/lib/kcl/sourceRange'

/**
 * Hiding and showing, as edits to the file.
 *
 * Visibility is a `hide(…)` call in the KCL, so a toggle is an edit like any
 * other and belongs beside `rollbackEdit`: the same shape, the same
 * responsibility, and the same reason to be pure — a list of text edits can be
 * tested against a string without a WASM module or an editor.
 *
 * Text rather than a recast AST, for the reason everything else here is: recasting
 * rewrites the whole file and returns a diff touching every line the formatter
 * disagrees with, which turns "hide this sketch" into a change nobody can review.
 */

/**
 * Hide something by name.
 *
 * Appended at the end of the file, which is not a shortcut: `hide` takes a value,
 * so the call has to come after whatever produced it, and the end of the file is
 * the only position that is always true of. It is also where somebody reading the
 * program would expect a display instruction to sit — after the model, not in the
 * middle of building it.
 *
 * The end of the *file* rather than of the last statement, so trailing comments
 * keep whatever they were written after.
 */
export function addHide(source: string, name: string): readonly TextEdit[] {
  // A newline first only when there is something to be after and it does not
  // already end in one. An empty file must not start with a blank line.
  const separator = source.length > 0 && !source.endsWith('\n') ? '\n' : ''

  return [
    {
      from: source.length,
      to: source.length,
      insert: `${separator}hide(${name})\n`,
    },
  ]
}

/**
 * Stop hiding something.
 *
 * Two shapes, because `hide` takes one object or a list of them. A call that
 * hides only this object goes entirely; a call that hides several loses one
 * term. Removing the whole call in the second case would un-hide everything
 * else in it, which is the kind of bug that looks like the app forgetting.
 */
export function removeHide(
  source: string,
  hideCall: Extract<Operation, { type: 'StdLibCall' }>,
  name: string
): readonly TextEdit[] {
  const [from, to] = sourceRangeToUtf16(source, hideCall.sourceRange)
  const text = source.slice(from, to)

  const argument = hideCall.unlabeledArg?.value
  const single = argument?.type !== 'Array' || argument.value.length <= 1

  if (single) {
    /*
     * The statement, and the newline after it. Leaving the blank line behind
     * would have a file slowly fill with the gaps where display instructions
     * used to be.
     */
    const trailing = source.slice(to).match(/^[ \t]*\r?\n/)
    return [{ from, to: to + (trailing?.[0].length ?? 0), insert: '' }]
  }

  /*
   * One term out of a list, found in the call's own text rather than by
   * rewriting the array: a word-boundary match on the name, which is exact
   * because these are KCL identifiers and cannot contain anything a boundary
   * would split.
   */
  const pattern = new RegExp(`(,\\s*)?\\b${name}\\b(\\s*,\\s*)?`)
  const match = pattern.exec(text)
  if (!match) return []

  const start = from + (match.index ?? 0)
  // Keep one separator when the term was between two others, so the list does
  // not end up with a doubled or a missing comma — spelled the way the formatter
  // spells one, since this text is what somebody will read next.
  const insert = match[1] && match[2] ? ', ' : ''

  return [{ from: start, to: start + match[0].length, insert }]
}

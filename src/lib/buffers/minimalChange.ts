/**
 * The smallest single replacement that turns one string into another.
 *
 * Used wherever a whole document is being replaced by a version of itself — an
 * external edit adopted, a divergence resolved. Replacing the document outright
 * is correct in the sense that the text ends up right, and wrong in every other
 * sense:
 *
 * - **It destroys the undo history.** CodeMirror maps existing history events
 *   through any change dispatched with `addToHistory` false, and a
 *   delete-everything-insert-everything mapping either drops those events or
 *   leaves them pointing at positions that no longer mean anything. Undo after
 *   an adopted external change was not trustworthy either way.
 * - **It collapses the selection**, because every position in the document was
 *   just deleted.
 * - **It is the whole file to the engine and the language server**, when a file
 *   that changed on disk usually changed in one place.
 *
 * A common prefix and suffix is not a diff — two edits in different places come
 * back as one span covering both — but it is exact, it is O(n) with no
 * allocation, and it makes the common case (a line changed, a line appended)
 * genuinely small. A real diff belongs here later if something needs it; nothing
 * about the callers would change.
 */
export interface MinimalChange {
  from: number
  to: number
  insert: string
}

export function minimalChange(
  current: string,
  next: string
): MinimalChange | null {
  if (current === next) return null

  const limit = Math.min(current.length, next.length)

  let prefix = 0
  while (prefix < limit && current[prefix] === next[prefix]) prefix += 1

  // Stops where the prefix ended, so the two spans cannot overlap on a string
  // that repeats — "aaa" to "aa" must not claim four characters in common.
  let suffix = 0
  while (
    suffix < limit - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1
  }

  return {
    from: prefix,
    to: current.length - suffix,
    insert: next.slice(prefix, next.length - suffix),
  }
}

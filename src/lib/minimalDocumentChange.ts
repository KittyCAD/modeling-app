type MinimalDocumentChange = {
  from: number
  to: number
  insert: string
}

/**
 * Computes the smallest single replacement that turns `currentCode` into
 * `nextCode` by preserving the longest shared prefix and suffix.
 *
 * KCL synchronization and cloud adoption use this replacement so CodeMirror
 * maps selections through unchanged text instead of replacing the entire document.
 *
 * If there are multiple disjoint edits, this still collapses them into a single
 * replacement range, so the text between those edits is included in the change.
 */
export function buildMinimalDocumentChange(
  currentCode: string,
  nextCode: string
): MinimalDocumentChange | null {
  if (currentCode === nextCode) {
    return null
  }

  let prefixLength = 0
  const maxPrefixLength = Math.min(currentCode.length, nextCode.length)
  while (
    prefixLength < maxPrefixLength &&
    currentCode.charCodeAt(prefixLength) === nextCode.charCodeAt(prefixLength)
  ) {
    prefixLength++
  }

  let currentSuffixStart = currentCode.length
  let nextSuffixStart = nextCode.length
  while (
    currentSuffixStart > prefixLength &&
    nextSuffixStart > prefixLength &&
    currentCode.charCodeAt(currentSuffixStart - 1) ===
      nextCode.charCodeAt(nextSuffixStart - 1)
  ) {
    currentSuffixStart--
    nextSuffixStart--
  }

  return {
    from: prefixLength,
    to: currentSuffixStart,
    insert: nextCode.slice(prefixLength, nextSuffixStart),
  }
}

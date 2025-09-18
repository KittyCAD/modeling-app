export const normalizeLineEndings = (str: string, normalized = '\n') => {
  return str.replace(/\r?\n/g, normalized)
}

/**
 * GOTCHA: string comparison is hard! Only use this when comparing two code strings
 * so that if we discover we're doing it wrong we only need to change this function.
 *
 * We use it right now to verify an OS file system "change" event isn't already known
 * about by our in-memory codeManager.
 */
export function isCodeTheSame(left: string, right: string) {
  const leftBasis = normalizeLineEndings(left)
  const rightBasis = normalizeLineEndings(right)
  // any other future logic that we failed to implement that causes a bug
  return leftBasis === rightBasis
}

import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'

/**
 * Convert a SourceRange as used inside the KCL interpreter into the above one for use in the
 * frontend (essentially we're eagerly checking whether the frontend should care about the SourceRange
 * so as not to expose details of the interpreter's current representation of module ids throughout
 * the frontend).
 */
export function sourceRangeFromRust(s: SourceRange): SourceRange {
  return [s[0], s[1], s[2]]
}

/**
 * Create a default SourceRange for testing or as a placeholder.
 */
export function defaultSourceRange(): SourceRange {
  return [0, 0, 0]
}

/**
 * Returns true if the first range is equal to or contains the second range.
 */
export function sourceRangeContains(
  outer: SourceRange,
  inner: SourceRange
): boolean {
  return outer[0] <= inner[0] && outer[1] >= inner[1] && outer[2] === inner[2]
}

/**
 * Writing a `region` call from what the engine knows.
 *
 * A region is the V2 way to name an area to extrude, and it has no artifact in
 * the graph because it does not exist until it is written into the file. What the
 * engine *can* answer, for an area under the cursor, is which two curves border
 * it and how they meet — which is exactly the argument list `region` takes.
 *
 * Pure, so the mapping from engine vocabulary to KCL vocabulary is testable
 * without an engine: `curve_clockwise` becomes `direction`, `intersection_index`
 * becomes `intersectionIndex`, and both are omitted when they would restate a
 * default.
 */

export interface RegionBoundary {
  /** KCL references to the two bordering segments: `triangle.line1`. */
  segments: readonly string[]
  /** Which crossing of the two curves bounds this region. */
  intersectionIndex: number
  /** How many times the two curves cross at all. */
  intersectionCount: number
  /** True when the region is inside a clockwise turn between them. */
  clockwise: boolean
}

export function regionExpression(boundary: RegionBoundary): string | null {
  const segments = boundary.segments.filter(Boolean)
  if (segments.length === 0) return null

  const parts = [`segments = [${segments.join(', ')}]`]

  // Only when it disambiguates. The docs are explicit that
  // `intersectionIndex` and `direction` are unnecessary for a single loop, and
  // writing them anyway makes generated KCL look machine-made.
  if (boundary.intersectionCount > 1) {
    parts.push(`intersectionIndex = ${boundary.intersectionIndex}`)
  }
  if (boundary.clockwise) {
    parts.push(`direction = CW`)
  }

  return `region(${parts.join(', ')})`
}

import type { Coords2d } from '@src/lang/util'
import { distance2d } from '@src/lib/utils2d'

/**
 * Multi-click sketch tools often create several connected segments after the
 * first click so the preview can be edited in place. Until the next anchor has
 * moved a small but meaningful distance, keep that seeded preview and ignore
 * confirmation clicks inside this radius instead of collapsing the draft into
 * overlapping points or zero-length segments.
 *
 * Reuse this policy for rectangle, polygon, and similar tools that would
 * otherwise emit degenerate geometry while the user is still establishing the
 * next edge.
 */
export const MIN_DRAFT_GEOMETRY_DELTA_MM = 0.1

export function hasCrossedDraftGeometryThreshold(
  anchor: Coords2d,
  candidate: Coords2d,
  minDelta = MIN_DRAFT_GEOMETRY_DELTA_MM
): boolean {
  return distance2d(anchor, candidate) >= minDelta
}

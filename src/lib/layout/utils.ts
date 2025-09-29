import type { Layout } from '@src/lib/layout/types'

/**
 * A split area must have split points equal to the divisions
 * between its children. Each point must be between 0 and 1.
 */
export function hasValidSplitPoints(area: Layout & { type: 'splits' }) {
  return (
    area.splitPoints.length === area.children.length - 1 &&
    area.splitPoints.every((p) => p > 0 && p < 1)
  )
}

/**
 * Split points must be sorted in ascending order
 */
export function sortSplitPoints(
  splitPoints: (Layout & { type: 'splits' })['splitPoints']
) {
  return splitPoints.sort((a, b) => a - b)
}

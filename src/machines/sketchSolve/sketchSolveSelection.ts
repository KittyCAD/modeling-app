import type { Coords2d } from '@src/lang/util'

export const ORIGIN_TARGET = 'origin'

export type SketchSpecialTarget = typeof ORIGIN_TARGET
export type SketchSolveSelectionId = number | SketchSpecialTarget
export type SelectionCoordinates = Partial<Record<number, Coords2d>>

export function isObjectSelectionId(
  id: SketchSolveSelectionId | null | undefined
): id is number {
  return typeof id === 'number'
}

export function getObjectSelectionIds(
  ids: readonly SketchSolveSelectionId[]
): number[] {
  return ids.filter(isObjectSelectionId)
}

/** Ordinary sketch clicks toggle membership; constraints can request replacement and empty clicks clear it. */
export function updateSketchSelection(
  current: readonly SketchSolveSelectionId[],
  incoming: readonly SketchSolveSelectionId[],
  coordinates: SelectionCoordinates = {},
  replace = false
) {
  const first = incoming[0]
  const selectedIds = !incoming.length
    ? []
    : replace
      ? [...incoming]
      : incoming.length === 1 && first !== undefined && current.includes(first)
        ? current.filter((id) => id !== first)
        : [...new Set([...current, ...incoming])]
  const selectionCoordinates: SelectionCoordinates = {}
  for (const id of selectedIds)
    if (typeof id === 'number' && coordinates[id])
      selectionCoordinates[id] = coordinates[id]
  return { selectedIds, selectionCoordinates }
}

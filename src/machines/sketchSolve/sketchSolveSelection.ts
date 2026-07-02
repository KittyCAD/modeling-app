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

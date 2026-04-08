export const ORIGIN_TARGET = 'origin'

export type SketchSpecialTarget = typeof ORIGIN_TARGET
export type SketchSolveSelectionId = number | SketchSpecialTarget

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

import type { DistanceType } from '@kittycad/lib'
import {
  isDefaultPlaneSelection,
  isEnginePrimitiveSelection,
  isEngineRegionSelection,
} from '@src/lib/selections'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'

export type DistanceMode = 'euclidean' | 'x' | 'y' | 'z'

export const distanceModes: Array<{ value: DistanceMode; label: string }> = [
  { value: 'euclidean', label: '3D' },
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
]

function getEntityIdsForGraphSelection(selection: Selection): string[] {
  if (selection.engineEntityId) {
    return [selection.engineEntityId]
  }

  const artifact = selection.artifact
  if (!artifact?.id) {
    return []
  }

  if (artifact.type !== 'pattern') {
    return [artifact.id]
  }

  return [
    ...new Set([
      ...artifact.copyIds,
      ...artifact.copyFaceIds,
      ...artifact.copyEdgeIds,
    ]),
  ]
}

export function getMeasurementEntityIds(selectionRanges: Selections): string[] {
  return [
    ...new Set([
      ...selectionRanges.graphSelections.flatMap(getEntityIdsForGraphSelection),
      ...selectionRanges.otherSelections.flatMap((selection) => {
        if (isEnginePrimitiveSelection(selection)) {
          return [selection.entityId]
        }
        if (isEngineRegionSelection(selection)) {
          return [selection.id]
        }
        if (isDefaultPlaneSelection(selection)) {
          return [selection.id]
        }
        return []
      }),
    ]),
  ]
}

export function getDistanceTypeForMode(mode: DistanceMode): DistanceType {
  if (mode === 'euclidean') {
    return { type: 'euclidean' }
  }
  return { type: 'on_axis', axis: mode }
}

export function formatDistance(value: number): string {
  if (!Number.isFinite(value)) {
    return '-'
  }

  const absoluteValue = Math.abs(value)
  if (
    absoluteValue !== 0 &&
    (absoluteValue >= 100_000 || absoluteValue < 0.001)
  ) {
    return value.toExponential(3)
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: 4,
  })
}

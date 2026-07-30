import type {
  DistanceType,
  Point3d,
  UnitArea,
  UnitLength,
  UnitVolume,
} from '@kittycad/lib'
import type { Artifact } from '@src/lang/std/artifactGraph'
import {
  isDefaultPlaneSelection,
  isEnginePrimitiveSelection,
  isEngineRegionSelection,
} from '@src/lib/selections'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'

export type DistanceMode = 'euclidean' | 'x' | 'y' | 'z'
export type MeasurementSelectionKind = 'face' | 'edge' | 'body' | 'other'

export type MeasurementEntity = {
  id: string
  kind: MeasurementSelectionKind
}

export const distanceModes: Array<{ value: DistanceMode; label: string }> = [
  { value: 'euclidean', label: '3D' },
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
]

const faceArtifactTypes: ReadonlySet<Artifact['type']> = new Set([
  'wall',
  'cap',
  'edgeCut',
  'primitiveFace',
])

const edgeArtifactTypes: ReadonlySet<Artifact['type']> = new Set([
  'segment',
  'sweepEdge',
  'edgeCutEdge',
  'primitiveEdge',
])

const bodyArtifactTypes: ReadonlySet<Artifact['type']> = new Set([
  'sweep',
  'compositeSolid',
])

const areaUnitByLengthUnit: Record<UnitLength, UnitArea> = {
  mm: 'mm2',
  cm: 'cm2',
  m: 'm2',
  in: 'in2',
  ft: 'ft2',
  yd: 'yd2',
}

const volumeUnitByLengthUnit: Record<UnitLength, UnitVolume> = {
  mm: 'mm3',
  cm: 'cm3',
  m: 'm3',
  in: 'in3',
  ft: 'ft3',
  yd: 'yd3',
}

const millimetersByLengthUnit: Record<UnitLength, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  yd: 914.4,
}

const lengthUnitConversionDecimalPlaces = 7

function getMeasurementKindForArtifact(
  artifact: Artifact | undefined
): MeasurementSelectionKind {
  if (!artifact) {
    return 'other'
  }

  if (faceArtifactTypes.has(artifact.type)) {
    return 'face'
  }

  if (edgeArtifactTypes.has(artifact.type)) {
    return 'edge'
  }

  if (bodyArtifactTypes.has(artifact.type)) {
    return 'body'
  }

  return 'other'
}

function getMeasurementKindForEntityType(
  entityType: string
): MeasurementSelectionKind {
  if (entityType === 'face') {
    return 'face'
  }

  if (
    entityType === 'edge' ||
    entityType === 'curve' ||
    entityType === 'segment'
  ) {
    return 'edge'
  }

  if (entityType === 'solid3d' || entityType === 'object') {
    return 'body'
  }

  return 'other'
}

function getEntitiesForGraphSelection(
  selection: Selection
): MeasurementEntity[] {
  if (selection.engineEntityId) {
    return [
      {
        id: selection.engineEntityId,
        kind: getMeasurementKindForArtifact(selection.artifact),
      },
    ]
  }

  const artifact = selection.artifact
  if (!artifact?.id) {
    return []
  }

  if (artifact.type !== 'pattern') {
    return [
      {
        id: artifact.id,
        kind: getMeasurementKindForArtifact(artifact),
      },
    ]
  }

  return dedupeMeasurementEntities([
    ...artifact.copyIds.map((id) => ({ id, kind: 'body' as const })),
    ...artifact.copyFaceIds.map((id) => ({ id, kind: 'face' as const })),
    ...artifact.copyEdgeIds.map((id) => ({ id, kind: 'edge' as const })),
  ])
}

function dedupeMeasurementEntities(
  entities: MeasurementEntity[]
): MeasurementEntity[] {
  const measurementEntities = new Map<string, MeasurementEntity>()
  for (const entity of entities) {
    if (!measurementEntities.has(entity.id)) {
      measurementEntities.set(entity.id, entity)
    }
  }
  return [...measurementEntities.values()]
}

export function getMeasurementEntities(
  selectionRanges: Selections
): MeasurementEntity[] {
  return dedupeMeasurementEntities([
    ...selectionRanges.graphSelections.flatMap(getEntitiesForGraphSelection),
    ...selectionRanges.otherSelections.flatMap(
      (selection): MeasurementEntity[] => {
        if (isEnginePrimitiveSelection(selection)) {
          return [
            {
              id: selection.entityId,
              kind: getMeasurementKindForEntityType(selection.primitiveType),
            },
          ]
        }
        if (isEngineRegionSelection(selection)) {
          return [{ id: selection.id, kind: 'other' }]
        }
        if (isDefaultPlaneSelection(selection)) {
          return [{ id: selection.id, kind: 'other' }]
        }
        return []
      }
    ),
  ])
}

export function getMeasurementEntityIds(selectionRanges: Selections): string[] {
  return getMeasurementEntities(selectionRanges).map((entity) => entity.id)
}

export function getDistanceTypeForMode(mode: DistanceMode): DistanceType {
  if (mode === 'euclidean') {
    return { type: 'euclidean' }
  }
  return { type: 'on_axis', axis: mode }
}

export function getAreaUnit(unit: UnitLength): UnitArea {
  return areaUnitByLengthUnit[unit]
}

export function getVolumeUnit(unit: UnitLength): UnitVolume {
  return volumeUnitByLengthUnit[unit]
}

/** Converts engine length measurements, returned in millimeters, to a display unit. */
export function convertLengthFromMm(value: number, unit: UnitLength): number {
  const roundedValue = Number(
    (value / millimetersByLengthUnit[unit]).toFixed(
      lengthUnitConversionDecimalPlaces
    )
  )
  return Object.is(roundedValue, -0) ? 0 : roundedValue
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

export function formatPoint3d(point: Point3d): string {
  return `${formatDistance(point.x)}, ${formatDistance(point.y)}, ${formatDistance(point.z)}`
}

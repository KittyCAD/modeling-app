import type { DistanceMode, MeasurementEntity } from './measurementUtils'

/**
 * A measurement operation that the tool can request after interpreting the
 * current selection set. The UI and status bar work with this normalized shape
 * instead of re-checking raw selection kinds.
 */
export type MeasurementTarget =
  | { type: 'distance'; entities: [MeasurementEntity, MeasurementEntity] }
  | { type: 'edgeLength'; entity: MeasurementEntity }
  | { type: 'faceSurfaceArea'; entity: MeasurementEntity }
  | { type: 'bodyDetails'; entity: MeasurementEntity }

/**
 * Describes one supported measurement rule. Each capability decides whether the
 * current selection can produce its target. Keep these rules small and
 * selection-focused; engine command details stay in MeasurementTool.
 */
export type MeasurementCapability = {
  type: MeasurementTarget['type']
  label: string
  /** Returns a request target when this capability supports the selection. */
  getTarget: (selectedEntities: MeasurementEntity[]) => MeasurementTarget | null
}

const defaultDistanceMode: DistanceMode = 'euclidean'

/** User-facing explanation for a known endpoint gap: body area works, face area does not. */
export const unsupportedFaceSurfaceAreaMessage =
  'Face surface area is not supported by the current engine endpoint. Select the body to measure total surface area, volume, and center of mass.'

/** User-facing explanation for the current entity_get_distance 3D topology limitation. */
export const unsupportedTopologyDistanceMessage =
  '3D distance between selected faces or edges is not supported by the current engine endpoint. Select X, Y, or Z distance instead.'

/**
 * Ordered list of measurement rules the tool uses to translate selected engine
 * entities into a measurement target. Add future specialized measurements, such
 * as circular-edge radius, before broader rules that could also match.
 */
export const measurementCapabilities: readonly MeasurementCapability[] = [
  {
    type: 'distance',
    label: 'Distance',
    getTarget(selectedEntities) {
      if (selectedEntities.length !== 2) {
        return null
      }

      return {
        type: 'distance',
        entities: [selectedEntities[0], selectedEntities[1]],
      }
    },
  },
  {
    type: 'edgeLength',
    label: 'Edge length',
    getTarget(selectedEntities) {
      if (selectedEntities.length !== 1) {
        return null
      }

      const [entity] = selectedEntities
      return entity.kind === 'edge' ? { type: 'edgeLength', entity } : null
    },
  },
  {
    type: 'faceSurfaceArea',
    label: 'Face surface area',
    getTarget(selectedEntities) {
      if (selectedEntities.length !== 1) {
        return null
      }

      const [entity] = selectedEntities
      return entity.kind === 'face' ? { type: 'faceSurfaceArea', entity } : null
    },
  },
  {
    type: 'bodyDetails',
    label: 'Body details',
    getTarget(selectedEntities) {
      if (selectedEntities.length !== 1) {
        return null
      }

      const [entity] = selectedEntities
      return entity.kind === 'body' ? { type: 'bodyDetails', entity } : null
    },
  },
]

/**
 * Returns the first measurement target supported by the selected entities.
 * This is the single entry point consumers should use when deciding whether the
 * current selection can be measured.
 */
export function getMeasurementTarget(
  selectedEntities: MeasurementEntity[]
): MeasurementTarget | null {
  for (const capability of measurementCapabilities) {
    const target = capability.getTarget(selectedEntities)
    if (target) {
      return target
    }
  }

  return null
}

/**
 * True when a two-entity distance request includes topology selections. The
 * engine currently supports axis-aligned distance for these selections, but 3D
 * distance returns a wrong-type error.
 */
export function hasTopologyDistanceSelection(
  entities: [MeasurementEntity, MeasurementEntity]
): boolean {
  return entities.some(
    (entity) => entity.kind === 'face' || entity.kind === 'edge'
  )
}

/**
 * Identifies target/mode combinations that we know will fail before sending a
 * modeling command, so the tool can show a clear message instead of surfacing a
 * low-level engine error.
 */
export function isUnsupportedDistanceMode(
  measurementTarget: MeasurementTarget,
  distanceMode: DistanceMode
): boolean {
  return (
    measurementTarget.type === 'distance' &&
    distanceMode === 'euclidean' &&
    hasTopologyDistanceSelection(measurementTarget.entities)
  )
}

/**
 * Chooses the best distance mode for a target. A user's previous axis choice is
 * respected across selections, except for unsupported 3D topology distance,
 * which falls back to X distance.
 */
export function getDefaultDistanceModeForTarget(
  measurementTarget: MeasurementTarget | null,
  preferredDistanceMode: DistanceMode | null
): DistanceMode {
  const usesTopologyDistance =
    measurementTarget?.type === 'distance' &&
    hasTopologyDistanceSelection(measurementTarget.entities)

  if (
    preferredDistanceMode &&
    !(preferredDistanceMode === 'euclidean' && usesTopologyDistance)
  ) {
    return preferredDistanceMode
  }

  if (usesTopologyDistance) {
    return 'x'
  }

  return defaultDistanceMode
}

/** Formats the short UI label for a distance mode control. */
export function getDistanceModeLabel(mode: DistanceMode): string {
  if (mode === 'euclidean') {
    return '3D'
  }

  return mode.toUpperCase()
}

/** Formats the status/copy label for a measured distance result. */
export function getDistanceMeasurementLabel(mode: DistanceMode): string {
  return `${getDistanceModeLabel(mode)} distance`
}

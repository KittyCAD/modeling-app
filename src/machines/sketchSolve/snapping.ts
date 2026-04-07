import type {
  ApiConstraint,
  ApiObject,
  Number as ConstraintNumber,
  ConstraintSegment,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import { distance2d } from '@src/lib/utils2d'
import {
  isPointSegment,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  findClosestApiObjects,
  getSketchHoverDistance,
} from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { ORIGIN_TARGET } from '@src/machines/sketchSolve/sketchSolveSelection'
import { Group } from 'three'

export const X_AXIS_TARGET = 'x-axis'
export const Y_AXIS_TARGET = 'y-axis'

export type SnapTarget =
  | { type: 'point'; pointId: number }
  | { type: typeof ORIGIN_TARGET }
  | { type: typeof X_AXIS_TARGET }
  | { type: typeof Y_AXIS_TARGET }

export type SnappingCandidate = {
  target: SnapTarget
  distance: number
  position: Coords2d
}

export function allowSnapping(mouseEvent: MouseEvent) {
  return !mouseEvent.shiftKey
}

export function isPointSnapTarget(
  target: SnapTarget | null | undefined
): target is Extract<SnapTarget, { type: 'point' }> {
  return target?.type === 'point'
}

export function getCoincidentSegmentsForSnapTarget(
  segmentId: number,
  target: SnapTarget | undefined
): ConstraintSegment[] | null {
  switch (target?.type) {
    case 'point':
      return [segmentId, target.pointId]
    case ORIGIN_TARGET:
      return [segmentId, 'ORIGIN']
    default:
      return null
  }
}

export function getConstraintForSnapTarget(
  segmentId: number,
  target: SnapTarget | undefined,
  units: ConstraintNumber['units']
): ApiConstraint | null {
  switch (target?.type) {
    case 'point':
    case ORIGIN_TARGET: {
      const segments = getCoincidentSegmentsForSnapTarget(segmentId, target)
      return segments === null
        ? null
        : {
            type: 'Coincident',
            segments,
          }
    }
    case X_AXIS_TARGET:
      return {
        type: 'VerticalDistance',
        points: [segmentId, 'ORIGIN'],
        distance: { value: 0, units },
        source: {
          expr: `0${units.toLowerCase()}`,
          is_literal: true,
        },
      }
    case Y_AXIS_TARGET:
      return {
        type: 'HorizontalDistance',
        points: [segmentId, 'ORIGIN'],
        distance: { value: 0, units },
        source: {
          expr: `0${units.toLowerCase()}`,
          is_literal: true,
        },
      }
    default:
      return null
  }
}

function getSnapTargetPriority(target: SnapTarget) {
  switch (target.type) {
    case 'point':
      return 0
    case ORIGIN_TARGET:
      return 1
    case X_AXIS_TARGET:
    case Y_AXIS_TARGET:
      return 2
  }
}

export function getSnappingCandidates(
  mousePosition: Coords2d,
  objects: ApiObject[],
  sceneInfra: SceneInfra
): SnappingCandidate[] {
  const pointCandidates = findClosestApiObjects(
    mousePosition,
    objects,
    sceneInfra
  ).flatMap((candidate): SnappingCandidate[] => {
    if (!isPointSegment(candidate.apiObject)) {
      // Only snapping to points for now, no other segments like lines
      return []
    }

    return [
      {
        target: {
          type: 'point' as const,
          pointId: candidate.apiObject.id,
        },
        distance: candidate.distance,
        position: pointToCoords2d(candidate.apiObject),
      },
    ]
  })

  const sketchSceneObject = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const sketchSceneGroup =
    sketchSceneObject instanceof Group ? sketchSceneObject : null
  const hoverDistance = getSketchHoverDistance(
    sceneInfra.getClientSceneScaleFactor(sketchSceneGroup)
  )
  const originDistance = distance2d(mousePosition, [0, 0])
  const originCandidates =
    originDistance <= hoverDistance
      ? [
          {
            target: { type: ORIGIN_TARGET as typeof ORIGIN_TARGET },
            distance: originDistance,
            position: [0, 0] as Coords2d,
          },
        ]
      : []

  const xAxisDistance = Math.abs(mousePosition[1])
  const xAxisCandidates =
    xAxisDistance <= hoverDistance
      ? [
          {
            target: { type: X_AXIS_TARGET as typeof X_AXIS_TARGET },
            distance: xAxisDistance,
            position: [mousePosition[0], 0] as Coords2d,
          },
        ]
      : []

  const yAxisDistance = Math.abs(mousePosition[0])
  const yAxisCandidates =
    yAxisDistance <= hoverDistance
      ? [
          {
            target: { type: Y_AXIS_TARGET as typeof Y_AXIS_TARGET },
            distance: yAxisDistance,
            position: [0, mousePosition[1]] as Coords2d,
          },
        ]
      : []

  return [
    ...pointCandidates,
    ...originCandidates,
    ...xAxisCandidates,
    ...yAxisCandidates,
  ].sort((a, b) => {
    const priorityDelta =
      getSnapTargetPriority(a.target) - getSnapTargetPriority(b.target)
    if (priorityDelta !== 0) {
      return priorityDelta
    }

    // Note: for point-point sorting this implicitly relies on the order coming from
    // findClosestApiObjects. This is fine because Array.sort is stable but we may want
    // to ensure that more explicitly here as well.
    // Eg. in the case of 2 coincident points findClosestApiObjects ensures the one with
    // the higherid gets comest first.
    return a.distance - b.distance
  })
}

import type {
  ApiConstraint,
  ApiObject,
  Number as ConstraintNumber,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import { distance2d } from '@src/lib/utils2d'
import {
  getArcPoints,
  getLinePoints,
  isArcSegment,
  isCircleSegment,
  isLineSegment,
  isPointSegment,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  findClosestApiObjects,
  getClosestPointOnArcSegment,
  getClosestPointOnCircleSegment,
  getClosestPointOnLineSegment,
  getSketchHoverDistance,
} from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { ORIGIN_TARGET } from '@src/machines/sketchSolve/sketchSolveSelection'
import type { ConstraintSegment } from '@src/machines/sketchSolve/types'
import { Group } from 'three'

export const X_AXIS_TARGET = 'x-axis'
export const Y_AXIS_TARGET = 'y-axis'

type CoincidentSnapTarget = {
  type: 'point' | 'line' | 'arc' | 'circle'
  id: number
}
type OriginSnapTarget = {
  type: typeof ORIGIN_TARGET
}
type AxisSnapTarget = {
  type: typeof X_AXIS_TARGET | typeof Y_AXIS_TARGET
}

export type SnapTarget =
  | CoincidentSnapTarget
  | OriginSnapTarget
  | AxisSnapTarget

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

export function getObjectIdForSnapTarget(
  target: SnapTarget | null | undefined
): number | null {
  return target !== null &&
    target !== undefined &&
    'id' in target &&
    typeof target.id === 'number'
    ? target.id
    : null
}

export function getCoincidentSegmentsForSnapTarget(
  segmentId: number,
  target: SnapTarget | undefined
): ConstraintSegment[] | null {
  if (
    target === undefined ||
    target.type === X_AXIS_TARGET ||
    target.type === Y_AXIS_TARGET
  ) {
    return null
  }

  return target.type === ORIGIN_TARGET ? [segmentId, 'ORIGIN'] : [segmentId, target.id]
}

export function getConstraintForSnapTarget(
  segmentId: number,
  target: SnapTarget | undefined,
  units: ConstraintNumber['units']
): ApiConstraint | null {
  switch (target?.type) {
    case 'point':
    case 'line':
    case 'arc':
    case 'circle':
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
        points: [segmentId, 'ORIGIN'] as unknown as [number, number],
        distance: { value: 0, units },
        source: {
          expr: `0${units.toLowerCase()}`,
          is_literal: true,
        },
      }
    case Y_AXIS_TARGET:
      return {
        type: 'HorizontalDistance',
        points: [segmentId, 'ORIGIN'] as unknown as [number, number],
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
    case 'line':
    case 'arc':
    case 'circle':
      return 3
  }
}

function getSnappingCandidateForApiObject(
  mousePosition: Coords2d,
  candidate: { distance: number; apiObject: ApiObject },
  objects: ApiObject[]
): SnappingCandidate | null {
  if (isPointSegment(candidate.apiObject)) {
    return {
      target: {
        type: 'point',
        id: candidate.apiObject.id,
      },
      distance: candidate.distance,
      position: pointToCoords2d(candidate.apiObject),
    }
  }

  if (isLineSegment(candidate.apiObject)) {
    const linePoints = getLinePoints(candidate.apiObject, objects)
    if (!linePoints) {
      return null
    }

    return {
      target: {
        type: 'line',
        id: candidate.apiObject.id,
      },
      distance: candidate.distance,
      position: getClosestPointOnLineSegment(mousePosition, linePoints)
        .closestPoint,
    }
  }

  if (isArcSegment(candidate.apiObject)) {
    const arcPoints = getArcPoints(candidate.apiObject, objects)
    if (!arcPoints) {
      return null
    }

    return {
      target: {
        type: 'arc',
        id: candidate.apiObject.id,
      },
      distance: candidate.distance,
      position: getClosestPointOnArcSegment(mousePosition, arcPoints)
        .closestPoint,
    }
  }

  if (isCircleSegment(candidate.apiObject)) {
    const circlePoints = getArcPoints(candidate.apiObject, objects)
    if (!circlePoints) {
      return null
    }

    return {
      target: {
        type: 'circle',
        id: candidate.apiObject.id,
      },
      distance: candidate.distance,
      position: getClosestPointOnCircleSegment(mousePosition, circlePoints)
        .closestPoint,
    }
  }

  return null
}

export function getSnappingCandidates(
  mousePosition: Coords2d,
  objects: ApiObject[],
  sceneInfra: SceneInfra
): SnappingCandidate[] {
  const geometricCandidates = findClosestApiObjects(
    mousePosition,
    objects,
    sceneInfra
  ).flatMap((candidate) => {
    const snappingCandidate = getSnappingCandidateForApiObject(
      mousePosition,
      candidate,
      objects
    )

    return snappingCandidate ? [snappingCandidate] : []
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
            target: { type: ORIGIN_TARGET },
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
            target: { type: X_AXIS_TARGET },
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
            target: { type: Y_AXIS_TARGET },
            distance: yAxisDistance,
            position: [0, mousePosition[1]] as Coords2d,
          },
        ]
      : []

  return [
    ...geometricCandidates,
    ...originCandidates,
    ...xAxisCandidates,
    ...yAxisCandidates,
  ].sort((a, b) => {
    const priorityDelta =
      getSnapTargetPriority(a.target) - getSnapTargetPriority(b.target)
    if (priorityDelta !== 0) {
      return priorityDelta
    }

    return a.distance - b.distance
  })
}

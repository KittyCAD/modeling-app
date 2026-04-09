import type {
  ApiConstraint,
  ApiObject,
  Number as ConstraintNumber,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import { getAngleDiff } from '@src/lib/utils'
import { distance2d, dot2d, subVec } from '@src/lib/utils2d'
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
  getSketchHoverDistance,
} from '@src/machines/sketchSolve/interaction/interactionHelpers'
import { ORIGIN_TARGET } from '@src/machines/sketchSolve/sketchSolveSelection'
import type { ConstraintSegment } from '@src/machines/sketchSolve/types'
import { Group } from 'three'

export const X_AXIS_TARGET = 'x-axis'
export const Y_AXIS_TARGET = 'y-axis'

export type SnapTarget =
  | { type: 'point'; pointId: number }
  | { type: 'line'; lineId: number }
  | { type: 'arc'; arcId: number }
  | { type: 'circle'; circleId: number }
  | { type: typeof ORIGIN_TARGET }
  | { type: typeof X_AXIS_TARGET }
  | { type: typeof Y_AXIS_TARGET }

export type SnappingCandidate = {
  target: SnapTarget
  distance: number
  position: Coords2d
}

type IndexedSnappingCandidate = SnappingCandidate & {
  sortIndex: number
}

export function allowSnapping(mouseEvent: MouseEvent) {
  return !mouseEvent.shiftKey
}

export function isPointSnapTarget(
  target: SnapTarget | null | undefined
): target is Extract<SnapTarget, { type: 'point' }> {
  return target?.type === 'point'
}

export function getSegmentIdForSnapTarget(
  target: SnapTarget | null | undefined
): number | null {
  switch (target?.type) {
    case 'point':
      return target.pointId
    case 'line':
      return target.lineId
    case 'arc':
      return target.arcId
    case 'circle':
      return target.circleId
    default:
      return null
  }
}

export function getCoincidentSegmentsForSnapTarget(
  segmentId: number,
  target: SnapTarget | undefined
): ConstraintSegment[] | null {
  switch (target?.type) {
    case 'point':
      return [segmentId, target.pointId]
    case 'line':
      return [segmentId, target.lineId]
    case 'arc':
      return [segmentId, target.arcId]
    case 'circle':
      return [segmentId, target.circleId]
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

function closestPointOnLineSegment(
  point: Coords2d,
  line: readonly [Coords2d, Coords2d]
): Coords2d {
  const [start, end] = line
  const segment = subVec(end, start)
  const segmentLengthSquared = dot2d(segment, segment)
  if (segmentLengthSquared === 0) {
    return [...start]
  }

  const startToPoint = subVec(point, start)
  const t = Math.max(
    0,
    Math.min(1, dot2d(startToPoint, segment) / segmentLengthSquared)
  )

  return [start[0] + segment[0] * t, start[1] + segment[1] * t]
}

function closestPointOnArcLikeSegment(
  point: Coords2d,
  arc: NonNullable<ReturnType<typeof getArcPoints>>
): Coords2d {
  const { center, start, end, isCircle } = arc
  const radius = distance2d(center, start)
  if (radius === 0) {
    return [...center]
  }

  const pointFromCenter = subVec(point, center)
  const pointLength = distance2d(point, center)
  if (pointLength === 0) {
    return [...start]
  }

  const pointAngle = Math.atan2(pointFromCenter[1], pointFromCenter[0])

  if (isCircle) {
    return [
      center[0] + radius * Math.cos(pointAngle),
      center[1] + radius * Math.sin(pointAngle),
    ]
  }

  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0])
  const sweepAngle = getAngleDiff(startAngle, endAngle, true)
  const pointSweepAngle = getAngleDiff(startAngle, pointAngle, true)
  const isWithinArcSweep = pointSweepAngle <= sweepAngle

  if (isWithinArcSweep) {
    return [
      center[0] + radius * Math.cos(pointAngle),
      center[1] + radius * Math.sin(pointAngle),
    ]
  }

  return distance2d(point, start) <= distance2d(point, end)
    ? [...start]
    : [...end]
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
        pointId: candidate.apiObject.id,
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
        lineId: candidate.apiObject.id,
      },
      distance: candidate.distance,
      position: closestPointOnLineSegment(mousePosition, linePoints),
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
        arcId: candidate.apiObject.id,
      },
      distance: candidate.distance,
      position: closestPointOnArcLikeSegment(mousePosition, arcPoints),
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
        circleId: candidate.apiObject.id,
      },
      distance: candidate.distance,
      position: closestPointOnArcLikeSegment(mousePosition, circlePoints),
    }
  }

  return null
}

export function getSnappingCandidates(
  mousePosition: Coords2d,
  objects: ApiObject[],
  sceneInfra: SceneInfra
): SnappingCandidate[] {
  const geometricCandidates: IndexedSnappingCandidate[] = findClosestApiObjects(
    mousePosition,
    objects,
    sceneInfra
  ).flatMap((candidate, index) => {
    const snappingCandidate = getSnappingCandidateForApiObject(
      mousePosition,
      candidate,
      objects
    )

    return snappingCandidate ? [{ ...snappingCandidate, sortIndex: index }] : []
  })

  const sketchSceneObject = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const sketchSceneGroup =
    sketchSceneObject instanceof Group ? sketchSceneObject : null
  const hoverDistance = getSketchHoverDistance(
    sceneInfra.getClientSceneScaleFactor(sketchSceneGroup)
  )
  const originDistance = distance2d(mousePosition, [0, 0])
  const originCandidates: IndexedSnappingCandidate[] =
    originDistance <= hoverDistance
      ? [
          {
            target: { type: ORIGIN_TARGET },
            distance: originDistance,
            position: [0, 0],
            sortIndex: geometricCandidates.length,
          },
        ]
      : []

  const xAxisDistance = Math.abs(mousePosition[1])
  const xAxisCandidates: IndexedSnappingCandidate[] =
    xAxisDistance <= hoverDistance
      ? [
          {
            target: { type: X_AXIS_TARGET },
            distance: xAxisDistance,
            position: [mousePosition[0], 0],
            sortIndex: geometricCandidates.length + originCandidates.length,
          },
        ]
      : []

  const yAxisDistance = Math.abs(mousePosition[0])
  const yAxisCandidates: IndexedSnappingCandidate[] =
    yAxisDistance <= hoverDistance
      ? [
          {
            target: { type: Y_AXIS_TARGET },
            distance: yAxisDistance,
            position: [0, mousePosition[1]],
            sortIndex:
              geometricCandidates.length +
              originCandidates.length +
              xAxisCandidates.length,
          },
        ]
      : []

  return [
    ...geometricCandidates,
    ...originCandidates,
    ...xAxisCandidates,
    ...yAxisCandidates,
  ]
    .sort((a, b) => {
      const priorityDelta =
        getSnapTargetPriority(a.target) - getSnapTargetPriority(b.target)
      if (priorityDelta !== 0) {
        return priorityDelta
      }

      if (Math.abs(a.distance - b.distance) < 1e-8) {
        return a.sortIndex - b.sortIndex
      }

      return a.distance - b.distance
    })
    .map(({ sortIndex: _sortIndex, ...candidate }) => candidate)
}

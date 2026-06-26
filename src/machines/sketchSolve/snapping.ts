import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import type RustContext from '@src/lib/rustContext'
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
  type: 'point' | 'line' | 'midpoint' | 'arc' | 'circle'
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

function isCoincidentSnapTarget(
  target: SnapTarget | null | undefined
): target is CoincidentSnapTarget {
  return (
    target?.type === 'point' ||
    target?.type === 'line' ||
    target?.type === 'midpoint' ||
    target?.type === 'arc' ||
    target?.type === 'circle'
  )
}

export function getObjectIdForSnapTarget(
  target: SnapTarget | null | undefined
): number | null {
  return isCoincidentSnapTarget(target) && typeof target.id === 'number'
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

  if (target.type === ORIGIN_TARGET) {
    return [segmentId, 'ORIGIN']
  }

  return isCoincidentSnapTarget(target) ? [segmentId, target.id] : null
}

export function getConstraintForSnapTarget(
  segmentId: number,
  target: SnapTarget | undefined
): ApiConstraint | null {
  return getConstraintsForSnapTarget(segmentId, target)[0] ?? null
}

export function getConstraintsForSnapTarget(
  segmentId: number,
  target: SnapTarget | undefined
): ApiConstraint[] {
  switch (target?.type) {
    case 'point':
    case 'line':
    case 'midpoint':
    case 'arc':
    case 'circle':
    case ORIGIN_TARGET: {
      const segments = getCoincidentSegmentsForSnapTarget(segmentId, target)
      if (segments === null) {
        return []
      }

      const constraints: ApiConstraint[] = [
        {
          type: 'Coincident',
          segments,
        },
      ]
      if (target.type === 'midpoint') {
        constraints.push({
          type: 'Midpoint',
          point: segmentId,
          segment: target.id,
        })
      }

      return constraints
    }
    case X_AXIS_TARGET:
      return [
        {
          type: 'Horizontal',
          points: [segmentId, 'ORIGIN'],
        },
      ]
    case Y_AXIS_TARGET:
      return [
        {
          type: 'Vertical',
          points: [segmentId, 'ORIGIN'],
        },
      ]
    default:
      return []
  }
}

export async function applyConstraintsForSnapTarget({
  segmentId,
  target,
  rustContext,
  sketchId,
  settings,
  createCheckpoint = false,
}: {
  segmentId: number
  target: SnapTarget | undefined
  rustContext: Pick<RustContext, 'addConstraint'>
  sketchId: number
  settings: Parameters<RustContext['addConstraint']>[3]
  createCheckpoint?: boolean
}) {
  const constraints = getConstraintsForSnapTarget(segmentId, target)
  let result: Awaited<ReturnType<RustContext['addConstraint']>> | null = null
  const newObjectIds: number[] = []

  for (const [index, constraint] of constraints.entries()) {
    const shouldCreateCheckpoint =
      createCheckpoint && index === constraints.length - 1
    result = shouldCreateCheckpoint
      ? await rustContext.addConstraint(0, sketchId, constraint, settings, true)
      : await rustContext.addConstraint(0, sketchId, constraint, settings)
    newObjectIds.push(...result.sceneGraphDelta.new_objects)
  }

  return {
    constraints,
    result,
    newObjectIds,
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
    case 'midpoint':
      return 3
    case 'line':
    case 'arc':
    case 'circle':
      return 4
  }
}

function getSnappingCandidateForApiObject(
  mousePosition: Coords2d,
  candidate: { distance: number; apiObject: ApiObject },
  objects: ApiObject[],
  hoverDistance: number
): SnappingCandidate[] {
  if (isPointSegment(candidate.apiObject)) {
    return [
      {
        target: {
          type: 'point',
          id: candidate.apiObject.id,
        },
        distance: candidate.distance,
        position: pointToCoords2d(candidate.apiObject),
      },
    ]
  }

  if (isLineSegment(candidate.apiObject)) {
    const linePoints = getLinePoints(candidate.apiObject, objects)
    if (!linePoints) {
      return []
    }

    const midpoint: Coords2d = [
      (linePoints[0][0] + linePoints[1][0]) / 2,
      (linePoints[0][1] + linePoints[1][1]) / 2,
    ]
    const snappingCandidates: SnappingCandidate[] = [
      {
        target: {
          type: 'line',
          id: candidate.apiObject.id,
        },
        distance: candidate.distance,
        position: getClosestPointOnLineSegment(mousePosition, linePoints)
          .closestPoint,
      },
    ]
    const midpointDistance = distance2d(mousePosition, midpoint)
    if (midpointDistance <= hoverDistance) {
      snappingCandidates.push({
        target: {
          type: 'midpoint',
          id: candidate.apiObject.id,
        },
        distance: midpointDistance,
        position: midpoint,
      })
    }

    return snappingCandidates
  }

  if (isArcSegment(candidate.apiObject)) {
    const arcPoints = getArcPoints(candidate.apiObject, objects)
    if (!arcPoints) {
      return []
    }

    return [
      {
        target: {
          type: 'arc',
          id: candidate.apiObject.id,
        },
        distance: candidate.distance,
        position: getClosestPointOnArcSegment(mousePosition, arcPoints)
          .closestPoint,
      },
    ]
  }

  if (isCircleSegment(candidate.apiObject)) {
    const circlePoints = getArcPoints(candidate.apiObject, objects)
    if (!circlePoints) {
      return []
    }

    return [
      {
        target: {
          type: 'circle',
          id: candidate.apiObject.id,
        },
        distance: candidate.distance,
        position: getClosestPointOnCircleSegment(mousePosition, circlePoints)
          .closestPoint,
      },
    ]
  }

  return []
}

export function getSnappingCandidates(
  mousePosition: Coords2d,
  objects: ApiObject[],
  sceneInfra: SceneInfra
): SnappingCandidate[] {
  const sketchSceneObject = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const sketchSceneGroup =
    sketchSceneObject instanceof Group ? sketchSceneObject : null
  const hoverDistance = getSketchHoverDistance(
    sceneInfra.getClientSceneScaleFactor(sketchSceneGroup)
  )
  const geometricCandidates = findClosestApiObjects(
    mousePosition,
    objects,
    sceneInfra
  ).flatMap((candidate) => {
    return getSnappingCandidateForApiObject(
      mousePosition,
      candidate,
      objects,
      hoverDistance
    )
  })

  const originDistance = distance2d(mousePosition, [0, 0])
  const originCandidates: SnappingCandidate[] =
    originDistance <= hoverDistance
      ? [
          {
            target: { type: ORIGIN_TARGET } satisfies OriginSnapTarget,
            distance: originDistance,
            position: [0, 0] as Coords2d,
          },
        ]
      : []

  const xAxisDistance = Math.abs(mousePosition[1])
  const xAxisCandidates: SnappingCandidate[] =
    xAxisDistance <= hoverDistance
      ? [
          {
            target: { type: X_AXIS_TARGET } satisfies AxisSnapTarget,
            distance: xAxisDistance,
            position: [mousePosition[0], 0] as Coords2d,
          },
        ]
      : []

  const yAxisDistance = Math.abs(mousePosition[0])
  const yAxisCandidates: SnappingCandidate[] =
    yAxisDistance <= hoverDistance
      ? [
          {
            target: { type: Y_AXIS_TARGET } satisfies AxisSnapTarget,
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

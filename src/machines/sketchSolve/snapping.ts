import type {
  ApiObject,
  CoincidentSegment,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
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
import { ORIGIN_TARGET } from '@src/machines/sketchSolve/sketchSolveImpl'
import { Group } from 'three'

export type SnapTarget =
  | { type: 'point'; pointId: number }
  | { type: typeof ORIGIN_TARGET }
  | { type: 'x-axis' }
  | { type: 'y-axis' }

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
): CoincidentSegment[] | null {
  switch (target?.type) {
    case 'point':
      return [segmentId, target.pointId]
    case ORIGIN_TARGET:
      return [segmentId, 'ORIGIN']
    default:
      return null
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
      // Only snapping to points for now
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

  return [...pointCandidates, ...originCandidates].sort((a, b) => {
    if (Math.abs(a.distance - b.distance) < 1e-8) {
      // Points should take precedence if tied with ORIGIN
      const isPointA = isPointSnapTarget(a.target)
      const isPointB = isPointSnapTarget(b.target)
      if (isPointA && !isPointB) {
        // a is point, b is ORIGIN -> a wins
        return -1
      }
      if (!isPointA && isPointB) {
        // a is ORIGIN, b is POINT -> b wins
        return 1
      }
    }

    // Note: for point-point sorting this implicitly relies on the order coming from
    // findClosestApiObjects. This is fine because Array.sort is stable but we may want
    // to more explicitly have it here too.
    return a.distance - b.distance
  })
}

import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import {
  isPointSegment,
  pointToCoords2d,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'

export type SnapTarget =
  | { type: 'point'; pointId: number }
  | { type: 'origin' }
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

export function getSnappingCandidates(
  mousePosition: Coords2d,
  objects: ApiObject[],
  sceneInfra: SceneInfra
): SnappingCandidate[] {
  return findClosestApiObjects(mousePosition, objects, sceneInfra).flatMap(
    (candidate) => {
      if (!isPointSegment(candidate.apiObject)) {
        // Only snapping to points for now
        return []
      }

      return [
        {
          target: {
            type: 'point',
            pointId: candidate.apiObject.id,
          },
          distance: candidate.distance,
          position: pointToCoords2d(candidate.apiObject),
        },
      ]
    }
  )
}

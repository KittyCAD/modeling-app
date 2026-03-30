import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import {
  isPointSegment,
  pointToCoords2d,
  type PointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'

export type SnappingCandidate = {
  apiObject: PointSegment
  distance: number
  position: Coords2d
}

export function getSnappingCandidates(
  mousePosition: Coords2d,
  {
    objects,
    sceneInfra,
  }: {
    objects: ApiObject[]
    sceneInfra: SceneInfra
  }
): SnappingCandidate[] {
  return findClosestApiObjects(mousePosition, objects, sceneInfra).flatMap(
    (candidate) => {
      if (!isPointSegment(candidate.apiObject)) {
        return []
      }

      return [
        {
          apiObject: candidate.apiObject,
          distance: candidate.distance,
          position: pointToCoords2d(candidate.apiObject),
        },
      ]
    }
  )
}

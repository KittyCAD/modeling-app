import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import {
  isLineSegment,
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
  existingPoint: PointSegment,
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
      if (
        !isPointSegment(candidate.apiObject) ||
        candidate.apiObject.id === existingPoint.id ||
        isOtherPointOnSameLine(existingPoint, candidate.apiObject, objects)
      ) {
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

function isOtherPointOnSameLine(
  existingPoint: PointSegment,
  candidatePoint: PointSegment,
  objects: ApiObject[]
) {
  if (
    existingPoint.kind.segment.owner === null ||
    existingPoint.kind.segment.owner !== candidatePoint.kind.segment.owner
  ) {
    return false
  }

  const owner = objects[existingPoint.kind.segment.owner]
  if (!isLineSegment(owner)) {
    return false
  }

  return (
    owner.kind.segment.start === candidatePoint.id ||
    owner.kind.segment.end === candidatePoint.id
  )
}

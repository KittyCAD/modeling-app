import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { Group } from 'three'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import { distance2d } from '@src/lib/utils2d'
import {
  isPointSegment,
  pointToCoords2d,
  type PointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { findClosestApiObjects } from '@src/machines/sketchSolve/interaction/interactionHelpers'

const SNAPPING_DISTANCE_PX = 8
const ORIGIN_POSITION: Coords2d = [0, 0]

export type SnappingCandidate =
  | {
      type: 'point'
      apiObject: PointSegment
      distance: number
      position: Coords2d
    }
  | {
      type: 'origin'
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
  const pointCandidates = findClosestApiObjects(
    mousePosition,
    objects,
    sceneInfra
  ).flatMap((candidate) => {
    if (
      !isPointSegment(candidate.apiObject) ||
      candidate.apiObject.id === existingPoint.id
    ) {
      return []
    }

    return [
      {
        type: 'point' as const,
        apiObject: candidate.apiObject,
        distance: candidate.distance,
        position: pointToCoords2d(candidate.apiObject),
      },
    ]
  })

  const originCandidate = getOriginSnappingCandidate(mousePosition, sceneInfra)
  const candidates =
    originCandidate === null
      ? pointCandidates
      : [...pointCandidates, originCandidate]

  return candidates.sort((a, b) => a.distance - b.distance)
}

function getOriginSnappingCandidate(
  mousePosition: Coords2d,
  sceneInfra: SceneInfra
): SnappingCandidate | null {
  const sketchSolveObject = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const sketchSolveGroup =
    sketchSolveObject instanceof Group ? sketchSolveObject : null
  const scale = sceneInfra.getClientSceneScaleFactor(sketchSolveGroup)
  const distance = distance2d(mousePosition, ORIGIN_POSITION)

  if (distance > SNAPPING_DISTANCE_PX * scale) {
    return null
  }

  return {
    type: 'origin',
    distance,
    position: ORIGIN_POSITION,
  }
}

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import { distance2d, dot2d, subVec } from '@src/lib/utils2d'
import type { SolveActionArgs } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  getLinePoints,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { Group } from 'three'

type SketchSolveSnapshot = ReturnType<SolveActionArgs['self']['getSnapshot']>
const HOVER_DISTANCE_PX = 12

function distanceToLineSegment(
  point: Coords2d,
  line: readonly [Coords2d, Coords2d]
): number {
  const [start, end] = line
  const segment = subVec(end, start)
  const segmentLengthSquared = dot2d(segment, segment)
  if (segmentLengthSquared === 0) {
    return distance2d(point, start)
  }

  const startToPoint = subVec(point, start)
  const t = Math.max(
    0,
    Math.min(1, dot2d(startToPoint, segment) / segmentLengthSquared)
  )
  const closestPoint: Coords2d = [
    start[0] + segment[0] * t,
    start[1] + segment[1] * t,
  ]

  return distance2d(point, closestPoint)
}

export type ClosestApiObject = {
  distance: number
  apiObject: ApiObject
}

export function findClosestApiObjects(
  mousePosition: Coords2d,
  snapshot: SketchSolveSnapshot,
  sceneInfra: SceneInfra
): ClosestApiObject[] {
  const objects =
    snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects
  if (!objects) {
    return []
  }

  const sketchSceneObject = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const hoverDistance =
    HOVER_DISTANCE_PX *
    sceneInfra.getClientSceneScaleFactor(
      sketchSceneObject instanceof Group ? sketchSceneObject : null
    )

  const candidates: ClosestApiObject[] = []

  objects.forEach((apiObject) => {
    if (isPointSegment(apiObject)) {
      const { position } = apiObject.kind.segment
      const distance = distance2d(mousePosition, [
        position.x.value,
        position.y.value,
      ])
      if (distance <= hoverDistance) {
        candidates.push({
          distance,
          apiObject,
        })
      }
      return
    }

    if (isLineSegment(apiObject)) {
      const linePoints = getLinePoints(apiObject, objects)
      if (linePoints) {
        const distance = distanceToLineSegment(mousePosition, linePoints)
        if (distance <= hoverDistance) {
          candidates.push({
            distance,
            apiObject,
          })
        }
      }
    }
  })

  return candidates.sort((a, b) => {
    const aPriority = isPointSegment(a.apiObject) ? 0 : 1
    const bPriority = isPointSegment(b.apiObject) ? 0 : 1
    return aPriority - bPriority || a.distance - b.distance
  })
}

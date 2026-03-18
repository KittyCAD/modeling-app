import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import { distance2d, dot2d, subVec } from '@src/lib/utils2d'
import type { SolveActionArgs } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  getLinePoints,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'

type SketchSolveSnapshot = ReturnType<SolveActionArgs['self']['getSnapshot']>

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
  _sceneInfra: SceneInfra
): ClosestApiObject[] {
  const objects =
    snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects
  if (!objects) {
    return []
  }

  const candidates: ClosestApiObject[] = []

  objects.forEach((apiObject) => {
    if (isPointSegment(apiObject)) {
      const { position } = apiObject.kind.segment
      candidates.push({
        distance: distance2d(mousePosition, [
          position.x.value,
          position.y.value,
        ]),
        apiObject,
      })
      return
    }

    if (isLineSegment(apiObject)) {
      const linePoints = getLinePoints(apiObject, objects)
      if (linePoints) {
        candidates.push({
          distance: distanceToLineSegment(mousePosition, linePoints),
          apiObject,
        })
      }
    }
  })

  return candidates.sort((a, b) => a.distance - b.distance)
}

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import { distance2d } from '@src/lib/utils2d'
import type { SolveActionArgs } from '@src/machines/sketchSolve/sketchSolveImpl'
import { isPointSegment } from '@src/machines/sketchSolve/constraints/constraintUtils'

type SketchSolveSnapshot = ReturnType<SolveActionArgs['self']['getSnapshot']>

export function findClosestApiObjects(
  mousePosition: Coords2d,
  snapshot: SketchSolveSnapshot,
  sceneInfra: SceneInfra
) {
  const objects =
    snapshot.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects
  if (!objects) {
    return []
  }

  return objects
    .flatMap((apiObject) => {
      if (!isPointSegment(apiObject)) {
        return []
      }

      const { position } = apiObject.kind.segment
      return [
        {
          distance: distance2d(mousePosition, [
            position.x.value,
            position.y.value,
          ]),
          apiObject,
        },
      ]
    })
    .sort((a, b) => a.distance - b.distance)
}

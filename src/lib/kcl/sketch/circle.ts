import type { SketchToolHost } from '@src/lib/kcl/sketch/contract'
import { createCircleSceneInteraction } from '@src/machines/sketchSolve/tools/circleInteraction'
import {
  createDraftCircle,
  updateDraftCircle,
  commitCircle,
} from '@src/machines/sketchSolve/tools/circleOperations'
import {
  getBestSceneSnappingCandidate,
  getGridSnapOptionsFromModelingSettings,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'

/** Adapt the editor's native lease and selection state to the same Circle interaction as the file route. */
export function createCircleInteraction(host: SketchToolHost) {
  const input = {
    sketchId: host.sketchId,
    lengthUnit: host.lengthUnit,
    rustContext: host.runtime.mutations,
  }
  return createCircleSceneInteraction({
    infra: host.infra,
    isCurrent: host.isCurrent,
    onError: host.onError,
    hover: host.hover,
    pick: (position, event, excluded) =>
      getBestSceneSnappingCandidate({
        sceneInfra: host.infra,
        sketchId: host.sketchId,
        mousePosition: position,
        mouseEvent: event,
        excludedPointIds: excluded,
        objects: host.getDelta().new_graph.objects,
        gridSnapOptions: getGridSnapOptionsFromModelingSettings(
          host.settings.current.peek().modeling,
          host.infra
        ),
      }),
    create: async (point) => {
      const result = await createDraftCircle({
        input: {
          ...input,
          centerPoint: point.position,
          centerSnapTarget: point.snap,
        },
      })
      if ('error' in result) return Promise.reject(new Error(result.error))
      return result
    },
    preview: (draft, point) =>
      updateDraftCircle({
        ...input,
        centerPoint: draft.center,
        startPoint: point.position,
        circleId: draft.circleId,
      }),
    commit: async (draft, point) => {
      const result = await commitCircle({
        input: {
          ...input,
          centerPoint: draft.center,
          startPoint: point.position,
          circleId: draft.circleId,
          startSnapTarget: point.snap,
        },
      })
      if ('error' in result) return Promise.reject(new Error(result.error))
      return result
    },
    remove: (draft) =>
      host.runtime.remove(host.sketchId, draft.segmentIds, draft.constraintIds),
    outcome: (result, kind, draft) => {
      if (kind === 'commit') host.accept(result)
      if (!host.isCurrent()) return
      host.render(result.sceneGraphDelta, draft, result.kclSource.text)
    },
  })
}

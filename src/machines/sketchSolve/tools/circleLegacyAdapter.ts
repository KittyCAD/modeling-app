import type {
  ToolInput,
  SketchSolveContext,
  SketchSolveMachineEvent,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { createCircleSceneInteraction } from '@src/machines/sketchSolve/tools/circleInteraction'
import {
  createDraftCircle,
  updateDraftCircle,
  commitCircle,
} from '@src/machines/sketchSolve/tools/circleToolImpl'
import { getBestSnappingCandidate } from '@src/machines/sketchSolve/tools/toolSnappingUtils'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import { toastSketchSolveError } from '@src/machines/sketchSolve/sketchSolveErrors'

/** The legacy parent keeps source/checkpoint ownership; Circle's interaction no longer belongs to its actor tree. */
export function createLegacyCircleInteraction(
  input: ToolInput,
  parent: {
    getSnapshot: () => {
      context: Pick<SketchSolveContext, 'sketchExecOutcome'>
    }
    send: (event: SketchSolveMachineEvent) => void
  }
) {
  let active = true
  const circle = createCircleSceneInteraction({
    infra: input.sceneInfra,
    isCurrent: () => active,
    onError: toastSketchSolveError,
    pick: (position, event, excluded) =>
      getBestSnappingCandidate({
        self: { _parent: parent },
        sceneInfra: input.sceneInfra,
        sketchId: input.sketchId,
        mousePosition: position,
        mouseEvent: event,
        excludedPointIds: excluded,
      }),
    hover: (hoveredId) =>
      parent.send({ type: 'update hovered id', data: { hoveredId } }),
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
    remove: async (draft) => {
      const result = await input.rustContext.deleteObjects(
        SKETCH_FILE_VERSION,
        input.sketchId,
        draft.constraintIds,
        draft.segmentIds,
        jsAppSettings(input.rustContext.settingsActor)
      )
      if (!result)
        return Promise.reject(new Error('Unable to remove the draft circle'))
      return result
    },
    outcome: (result, kind, draft) => {
      if (draft) parent.send({ type: 'set draft entities', data: draft })
      else parent.send({ type: 'clear draft entities' })
      parent.send({
        type: 'update sketch outcome',
        data: {
          sourceDelta: result.kclSource,
          sceneGraphDelta: result.sceneGraphDelta,
          checkpointId: result.checkpointId ?? null,
          ...(kind === 'commit' ? {} : { writeToDisk: false }),
        },
      })
    },
  })
  return {
    ...circle,
    dispose: async () => {
      active = false
      await circle.dispose()
    },
  }
}

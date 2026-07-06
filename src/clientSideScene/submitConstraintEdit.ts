import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { toastSketchSolveError } from '@src/machines/sketchSolve/sketchSolveErrors'

type ConstraintEditActor = {
  getSnapshot: () => unknown
  send: (event: ConstraintEditActorEvent) => void
}

type ConstraintEditActorEvent =
  | { type: 'stop editing constraint' }
  | {
      type: 'update sketch outcome'
      data: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId: number | null
      }
    }

type ConstraintEditSettings = Parameters<RustContext['editConstraint']>[4]

export async function submitConstraintEdit({
  sketchSolveActor,
  rustContext,
  editingConstraintId,
  value,
  settings,
}: {
  sketchSolveActor?: ConstraintEditActor
  rustContext: Pick<RustContext, 'editConstraint'>
  editingConstraintId: number
  value: string
  settings: ConstraintEditSettings
}) {
  sketchSolveActor?.send({ type: 'stop editing constraint' })

  try {
    const result = await rustContext.editConstraint(
      SKETCH_FILE_VERSION,
      getSketchIdFromSnapshot(sketchSolveActor?.getSnapshot()),
      editingConstraintId,
      value,
      settings,
      true
    )
    if (result) {
      sketchSolveActor?.send({
        type: 'update sketch outcome',
        data: {
          sourceDelta: result.kclSource,
          sceneGraphDelta: result.sceneGraphDelta,
          checkpointId: result.checkpointId ?? null,
        },
      })
    }
  } catch (e) {
    console.error('Failed to edit constraint:', e)
    toastSketchSolveError(e, 'Failed to edit constraint')
  }
}

function getSketchIdFromSnapshot(snapshot: unknown) {
  if (
    snapshot &&
    typeof snapshot === 'object' &&
    'context' in snapshot &&
    snapshot.context &&
    typeof snapshot.context === 'object' &&
    'sketchId' in snapshot.context &&
    typeof snapshot.context.sketchId === 'number'
  ) {
    return snapshot.context.sketchId
  }

  return 0
}

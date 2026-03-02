import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclManager } from '@src/lang/KclManager'
import { executeAstMock } from '@src/lang/langHelpers'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { deleteFromSelection } from '@src/lang/modifyAst/deleteFromSelection'
import { rewireAfterDelete } from '@src/lang/modifyAst/rewire'
import { EXECUTION_TYPE_REAL, SKETCH_FILE_VERSION } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { err } from '@src/lib/trap'
import type { Selection } from '@src/machines/modelingSharedTypes'

export const deletionErrorMessage =
  'Unable to delete selection. Please edit manually in code pane.'

export async function deleteSelectionPromise({
  selection,
  systemDeps,
}: {
  selection: Selection
  systemDeps: {
    kclManager: KclManager
    rustContext: RustContext
  }
}): Promise<Error | undefined> {
  const ast = systemDeps.kclManager.ast

  // Filtering on type here for Rust API based deletion, as this is the point of convergence
  // of deletion calls, from the feature tree but also Delete hotkey globally.
  if (
    selection.artifact?.type === 'sketchBlock' ||
    selection.artifact?.type === 'sketchBlockConstraint'
  ) {
    let result:
      | {
          kclSource: SourceDelta
          sceneGraphDelta: SceneGraphDelta
        }
      | undefined = undefined
    try {
      const settings = await jsAppSettings(systemDeps.rustContext.settingsActor)
      switch (selection.artifact.type) {
        case 'sketchBlock':
          result = await systemDeps.rustContext.deleteSketch(
            SKETCH_FILE_VERSION,
            selection.artifact.sketchId,
            settings
          )
          break
        case 'sketchBlockConstraint':
          result = await systemDeps.rustContext.deleteObjects(
            SKETCH_FILE_VERSION,
            selection.artifact.sketchId,
            [selection.artifact.constraintId],
            [],
            settings
          )
          break
        default: {
          const _exhaustiveCheck: never = selection.artifact
          return new Error('Should never happen at runtime')
        }
      }
    } catch (e) {
      console.error('Error deleting sketch:', e)
      return e as Error
    }

    systemDeps.kclManager.updateCodeEditor(result.kclSource.text, {
      shouldExecute: true,
      shouldWriteToDisk: true,
    })
    return
  }

  // AST based deletion, we should stop adding cases in there
  const modifiedAst = await deleteFromSelection(
    ast,
    selection,
    systemDeps.kclManager.variables,
    systemDeps.kclManager.artifactGraph,
    await systemDeps.kclManager.wasmInstancePromise,
    systemDeps.kclManager.sceneEntitiesManager.getFaceDetails.bind(
      systemDeps.kclManager.sceneEntitiesManager
    )
  )
  if (err(modifiedAst)) {
    return new Error(deletionErrorMessage)
  }

  const rewiredAst = rewireAfterDelete(ast, modifiedAst)
  let astToApply = rewiredAst

  const rewiredExecute = await executeAstMock({
    ast: rewiredAst,
    rustContext: systemDeps.rustContext,
  })

  if (
    rewiredExecute.errors.length &&
    rewiredAst !== modifiedAst // Rewire pass changed the AST, so try the pre-rewire result before failing.
  ) {
    const baselineExecute = await executeAstMock({
      ast: modifiedAst,
      rustContext: systemDeps.rustContext,
    })

    if (baselineExecute.errors.length) {
      return new Error(deletionErrorMessage)
    }

    astToApply = modifiedAst
  } else if (rewiredExecute.errors.length) {
    return new Error(deletionErrorMessage)
  }

  await updateModelingState(
    astToApply,
    EXECUTION_TYPE_REAL,
    {
      kclManager: systemDeps.kclManager,
      rustContext: systemDeps.rustContext,
    },
    {
      isDeleting: true,
    }
  )
}

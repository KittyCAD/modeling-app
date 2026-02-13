import { executeAstMock } from '@src/lang/langHelpers'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { deleteFromSelection } from '@src/lang/modifyAst/deleteFromSelection'
import { EXECUTION_TYPE_REAL, SKETCH_FILE_VERSION } from '@src/lib/constants'
import type { Selection } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import type { KclManager } from '@src/lang/KclManager'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'

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
    sceneEntitiesManager: SceneEntities
  }
}): Promise<Error | undefined> {
  let ast = systemDeps.kclManager.ast

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
        default:
          const _exhaustiveCheck: never = selection.artifact
          return new Error('Should never happen at runtime')
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
    systemDeps.sceneEntitiesManager.getFaceDetails.bind(
      systemDeps.sceneEntitiesManager
    )
  )
  if (err(modifiedAst)) {
    return new Error(deletionErrorMessage)
  }

  const testExecute = await executeAstMock({
    ast: modifiedAst,
    rustContext: systemDeps.rustContext,
  })
  if (testExecute.errors.length) {
    return new Error(deletionErrorMessage)
  }
  await updateModelingState(
    modifiedAst,
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

import { executeAstMock } from '@src/lang/langHelpers'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { deleteFromSelection } from '@src/lang/modifyAst/deleteFromSelection'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import type { Selection } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import type { KclManager } from '@src/lang/KclManager'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type RustContext from '@src/lib/rustContext'

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

  const modifiedAst = await deleteFromSelection(
    ast,
    selection,
    systemDeps.kclManager.variables,
    systemDeps.kclManager.artifactGraph,
    systemDeps.sceneEntitiesManager.getFaceDetails
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

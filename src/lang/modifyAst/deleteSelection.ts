import { executeAstMock } from '@src/lang/langHelpers'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { deleteFromSelection } from '@src/lang/modifyAst'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import type { Selection } from '@src/lib/selections'
import {
  codeManager,
  editorManager,
  kclManager,
  rustContext,
  sceneEntitiesManager,
} from '@src/lib/singletons'
import { err } from '@src/lib/trap'

export const deletionErrorMessage =
  'Unable to delete selection. Please edit manually in code pane.'

export async function deleteSelectionPromise(
  selection: Selection
): Promise<Error | void> {
  let ast = kclManager.ast

  const modifiedAst = await deleteFromSelection(
    ast,
    selection,
    kclManager.variables,
    kclManager.artifactGraph,
    sceneEntitiesManager.getFaceDetails
  )
  if (err(modifiedAst)) {
    return new Error(deletionErrorMessage)
  }

  const testExecute = await executeAstMock({
    ast: modifiedAst,
    rustContext: rustContext,
  })
  if (testExecute.errors.length) {
    return new Error(deletionErrorMessage)
  }
  await updateModelingState(modifiedAst, EXECUTION_TYPE_REAL, {
    kclManager,
    editorManager,
    codeManager,
  })
}

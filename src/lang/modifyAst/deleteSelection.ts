import { Selection } from 'lib/selections'
import { getFaceDetails } from 'clientSideScene/sceneEntities'
import { deleteFromSelection } from 'lang/modifyAst'
import {
  codeManager,
  editorManager,
  kclManager,
  rustContext,
} from 'lib/singletons'
import { err } from 'lib/trap'
import { executeAstMock } from 'lang/langHelpers'
import { updateModelingState } from 'lang/modelingWorkflows'
import { EXECUTION_TYPE_REAL } from 'lib/constants'

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
    getFaceDetails
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

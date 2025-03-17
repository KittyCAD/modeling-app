import { Selection } from 'lib/selections'
import { getFaceDetails } from 'clientSideScene/sceneEntities'
import { deleteFromSelection } from 'lang/modifyAst'
import { codeManager, engineCommandManager, kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { executeAstMock } from 'lang/langHelpers'

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
    engineCommandManager.artifactGraph,
    getFaceDetails
  )
  if (err(modifiedAst)) {
    return new Error(deletionErrorMessage)
  }

  const testExecute = await executeAstMock({
    ast: modifiedAst,
  })
  if (testExecute.errors.length) {
    return new Error(deletionErrorMessage)
  }

  await kclManager.updateAst(modifiedAst, true)
  await codeManager.updateEditorWithAstAndWriteToFile(modifiedAst)
}

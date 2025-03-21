/**
 * Modeling Workflows
 *
 * This module contains higher-level CAD operation workflows that
 * coordinate between different subsystems in the modeling app:
 * AST, code editor, file system and 3D engine.
 */

import { Node } from '@rust/kcl-lib/bindings/Node'
import { KclManager } from 'lang/KclSingleton'
import { PathToNode, Program, SourceRange } from 'lang/wasm'
import EditorManager from 'editor/manager'
import CodeManager from 'lang/codeManager'

/**
 * Updates the complete modeling state:
 * AST, code editor, file, and 3D scene.
 *
 * Steps:
 * 1. Updates the AST and internal state
 * 2. Updates the code editor and writes to file
 * 3. Sets focus in the editor if needed
 * 4. Attempts to execute the model in the 3D engine
 *
 * This function follows common CAD application patterns where:
 *
 * - The feature tree reflects user's actions
 * - The engine does its best to visualize what's possible
 * - Invalid operations appear in feature tree but may not render fully
 *
 * This ensures the user can edit the feature tree,
 * regardless of geometric validity issues.
 *
 * @param ast - AST to commit
 * @param dependencies - Required system components
 * @param options - Optional parameters for focus, zoom, etc.
 */

export async function updateModelingState(
  ast: Node<Program>,
  dependencies: {
    kclManager: KclManager
    editorManager: EditorManager
    codeManager: CodeManager
  },
  options?: {
    focusPath?: Array<PathToNode>
    zoomToFit?: boolean
    zoomOnRangeAndType?: {
      range: SourceRange
      type: string
    }
  }
): Promise<void> {
  // Step 1: Update AST without executing (prepare selections)
  const updatedAst = await dependencies.kclManager.updateAst(
    ast,
    false, // Execution handled separately for error resilience
    options
  )

  // Step 2: Update the code editor and save file
  await dependencies.codeManager.updateEditorWithAstAndWriteToFile(
    updatedAst.newAst
  )

  // Step 3: Set focus on the newly added code if needed
  if (updatedAst.selections) {
    dependencies.editorManager.selectRange(updatedAst.selections)
  }

  // Step 4: Try to execute the new code in the engine
  // and continue regardless of errors
  try {
    await dependencies.kclManager.executeAst({
      ast: updatedAst.newAst,
      zoomToFit: options?.zoomToFit,
      zoomOnRangeAndType: options?.zoomOnRangeAndType,
    })
  } catch (e) {
    console.error('Engine execution error (UI is still updated):', e)
  }
}

/**
 * Modeling Workflows
 *
 * This module contains higher-level CAD operation workflows that
 * coordinate between different subsystems in the app
 * AST, code editor, file system and 3D engine.
 */
import type { Node } from '@rust/kcl-lib/bindings/Node'

import type RustContext from '@src/lib/rustContext'
import { executeAstMock } from '@src/lang/langHelpers'
import type EditorManager from '@src/editor/manager'
import type { KclManager } from '@src/lang/KclSingleton'
import type CodeManager from '@src/lang/codeManager'
import type { PathToNode, Program } from '@src/lang/wasm'
import type { ExecutionType } from '@src/lib/constants'
import {
  EXECUTION_TYPE_MOCK,
  EXECUTION_TYPE_NONE,
  EXECUTION_TYPE_REAL,
} from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { err, reject } from '@src/lib/trap'

export async function mockExecAstAndReportErrors(
  ast: Node<Program>,
  rustContext: RustContext
): Promise<undefined | Error> {
  const { errors } = await executeAstMock({ ast, rustContext })
  if (errors.length > 0) {
    return new Error(errors.map((e) => e.message).join('\n'))
  }
}

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
 * @param executionType - How to execute the AST
 * @param dependencies - Required system components
 * @param options - Optional parameters for focus, zoom, etc.
 */
export async function updateModelingState(
  ast: Node<Program>,
  executionType: ExecutionType,
  dependencies: {
    kclManager: KclManager
    editorManager: EditorManager
    codeManager: CodeManager
    rustContext: RustContext
  },
  options?: {
    focusPath?: Array<PathToNode>
    isDeleting?: boolean
    skipErrorsOnMockExecution?: boolean
  }
): Promise<void> {
  let updatedAst: {
    newAst: Node<Program>
    selections?: Selections
  } = { newAst: ast }

  // Step 0: Mock execute shit so we know it aint broke
  if (!options?.skipErrorsOnMockExecution) {
    const res = await mockExecAstAndReportErrors(ast, dependencies.rustContext)
    if (err(res)) {
      return Promise.reject(res)
    }
  }

  // Step 1: Update AST without executing (prepare selections)
  updatedAst = await dependencies.kclManager.updateAst(
    ast,
    false, // Execution handled separately for error resilience
    options
  )

  // Step 2: Update the code editor and save file
  await dependencies.codeManager.updateEditorWithAstAndWriteToFile(
    updatedAst.newAst,
    {
      isDeleting: options?.isDeleting,
    }
  )

  // Step 3: Set focus on the newly added code if needed
  if (updatedAst.selections) {
    dependencies.editorManager.selectRange(updatedAst.selections)
  }

  // Step 4: Try to execute the new code
  // and continue regardless of errors
  try {
    if (executionType === EXECUTION_TYPE_REAL) {
      await dependencies.kclManager.executeAst({
        ast: updatedAst.newAst,
      })
    } else if (executionType === EXECUTION_TYPE_MOCK) {
      const didReParse = await dependencies.kclManager.executeAstMock(
        updatedAst.newAst
      )
      if (err(didReParse)) return reject(didReParse)
    } else if (executionType === EXECUTION_TYPE_NONE) {
      // No execution.
    }
  } catch (e) {
    console.error('KCL execution error (UI is still updated):', e)
  }
}

import { describe, expect, it, vi } from 'vitest'

import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { KclManager } from '@src/lang/KclManager'
import { executeAstMock } from '@src/lang/executeAstMock'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import type { ExecState, PathToNode, Program } from '@src/lang/wasm'
import { EXECUTION_TYPE_NONE } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'

vi.mock('@src/lang/executeAstMock', () => ({
  executeAstMock: vi.fn(),
}))

describe('updateModelingState', () => {
  it('uses fresh memory for validation and committing a complete codemod AST', async () => {
    const ast = {} as Node<Program>
    const rustContext = {} as RustContext
    const focusPath: PathToNode[] = [[['body', '']]]
    const updateAst = vi.fn().mockResolvedValue({ newAst: ast })
    const updateEditorWithAstAndWriteToFile = vi
      .fn()
      .mockResolvedValue(undefined)
    const kclManager = {
      rustContext,
      path: 'project/main.kcl',
      updateAst,
      updateEditorWithAstAndWriteToFile,
    } as unknown as KclManager
    vi.mocked(executeAstMock).mockResolvedValueOnce({
      logs: [],
      errors: [],
      execState: {} as ExecState,
      isInterrupted: false,
    })

    await updateModelingState(ast, EXECUTION_TYPE_NONE, kclManager, {
      focusPath,
    })

    expect(executeAstMock).toHaveBeenCalledWith({
      ast,
      rustContext,
      path: kclManager.path,
      usePrevMemory: false,
    })
    expect(updateAst).toHaveBeenCalledWith(ast, false, {
      focusPath,
      usePrevMemory: false,
    })
    expect(updateEditorWithAstAndWriteToFile).toHaveBeenCalledWith(ast, {
      isDeleting: undefined,
      allowProgrammaticDocumentChanges: true,
    })
  })
})

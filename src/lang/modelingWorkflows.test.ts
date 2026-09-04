import type { Node } from '@rust/kcl-lib/bindings/Node'

import type { KclManager } from '@src/lang/KclManager'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import type { Program } from '@src/lang/wasm'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { describe, expect, it, vi } from 'vitest'

describe('updateModelingState', () => {
  it('focuses code after execution refreshes the artifact graph', async () => {
    const calls: string[] = []
    const ast = {} as Node<Program>
    const selections: Selections = {
      graphSelections: [],
      otherSelections: [],
    }
    const kclManager = {
      updateAst: vi.fn(async () => {
        calls.push('updateAst')
        return { newAst: ast, selections }
      }),
      updateEditorWithAstAndWriteToFile: vi.fn(async () => {
        calls.push('updateEditor')
      }),
      executeAst: vi.fn(async () => {
        calls.push('executeAst')
      }),
      selectRange: vi.fn(() => {
        calls.push('selectRange')
      }),
    } as unknown as KclManager

    await updateModelingState(ast, EXECUTION_TYPE_REAL, kclManager, {
      skipErrorsOnMockExecution: true,
    })

    expect(calls).toEqual([
      'updateAst',
      'updateEditor',
      'executeAst',
      'selectRange',
    ])
  })
})

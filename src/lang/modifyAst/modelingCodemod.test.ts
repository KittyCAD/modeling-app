import { describe, expect, it, vi } from 'vitest'

import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { KclManager } from '@src/lang/KclManager'
import { mockExecAstAndReportErrors } from '@src/lang/modelingWorkflows'
import {
  createModelingCodemodReviewValidation,
  defineModelingCodemod,
} from '@src/lang/modifyAst/modelingCodemod'
import type { Program } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'

vi.mock('@src/lang/modelingWorkflows', () => ({
  mockExecAstAndReportErrors: vi.fn(),
  updateModelingState: vi.fn(),
}))

describe('createModelingCodemodReviewValidation', () => {
  it('includes the attempted code when mock execution fails', async () => {
    const initialCode = 'part = extrude(sketch, length = 10)'
    let currentCode = initialCode
    const proposedCode = 'part = extrude(sketch, length = -10)'
    const modifiedAst = { start: 0, end: proposedCode.length } as Node<Program>
    const wasmInstance = {
      recast_wasm: vi.fn().mockReturnValue(proposedCode),
    } as unknown as ModuleType
    const kclManager = {
      ast: modifiedAst,
      get code() {
        return currentCode
      },
      fileSettings: {},
    } as KclManager
    const executionError = new Error('Mock execution failed')
    vi.mocked(mockExecAstAndReportErrors).mockResolvedValueOnce(executionError)

    const validate = createModelingCodemodReviewValidation(
      defineModelingCodemod({
        run: () => ({
          modifiedAst,
          pathToNode: [],
        }),
      })
    )

    const resultPromise = validate(
      {
        argumentsToSubmit: {},
        wasmInstancePromise: Promise.resolve(wasmInstance),
      },
      {
        getSnapshot: () => ({
          context: {
            engineCommandManager: {
              connection: { connected: true },
            } as unknown as ConnectionManager,
            kclManager,
            rustContext: {} as RustContext,
          },
        }),
      }
    )
    currentCode = 'part = extrude(sketch, length = 20)'
    const result = await resultPromise

    expect(result).toBeInstanceOf(Error)
    expect(result?.message).toBe(executionError.message)
    expect(result?.cause).toBe(executionError)
    expect(result?.reviewDetails).toEqual({
      type: 'codemod',
      currentCode: initialCode,
      proposedCode,
    })
    expect(wasmInstance.recast_wasm).toHaveBeenCalledWith(
      JSON.stringify(modifiedAst)
    )
  })
})

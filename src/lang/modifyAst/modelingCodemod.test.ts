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
  it('snapshots the code and AST together after WASM resolves', async () => {
    const initialCode = 'part = extrude(sketch, length = 10)'
    let currentCode = initialCode
    const initialAst = { start: 0, end: initialCode.length } as Node<Program>
    let currentAst = initialAst
    const currentCodeAfterWasm = 'part = extrude(sketch, length = 20)'
    const currentAstAfterWasm = {
      start: 0,
      end: currentCodeAfterWasm.length,
    } as Node<Program>
    const proposedCode = 'part = extrude(sketch, length = -10)'
    const modifiedAst = { start: 0, end: proposedCode.length } as Node<Program>
    const wasmInstance = {
      recast_wasm: vi.fn().mockReturnValue(proposedCode),
    } as unknown as ModuleType
    const kclManager = {
      get ast() {
        return currentAst
      },
      get code() {
        return currentCode
      },
      fileSettings: {},
    } as KclManager
    const executionError = new Error('Mock execution failed')
    vi.mocked(mockExecAstAndReportErrors).mockResolvedValueOnce(executionError)

    const run = vi.fn(({ ast }: { ast: Node<Program> }) => {
      expect(ast).toBe(currentAstAfterWasm)
      return {
        modifiedAst,
        pathToNode: [],
      }
    })
    const validate = createModelingCodemodReviewValidation(
      defineModelingCodemod({
        run,
      })
    )

    let resolveWasmInstance: (wasmInstance: ModuleType) => void = () => {}
    const wasmInstancePromise = new Promise<ModuleType>((resolve) => {
      resolveWasmInstance = resolve
    })
    const resultPromise = validate(
      {
        argumentsToSubmit: {},
        wasmInstancePromise,
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
    currentCode = currentCodeAfterWasm
    currentAst = currentAstAfterWasm
    resolveWasmInstance(wasmInstance)
    const result = await resultPromise

    expect(run).toHaveBeenCalledOnce()
    expect(result).toBeInstanceOf(Error)
    expect(result?.message).toBe(executionError.message)
    expect(result?.cause).toBe(executionError)
    expect(result?.reviewDetails).toEqual({
      type: 'codemod',
      currentCode: currentCodeAfterWasm,
      proposedCode,
    })
    expect(wasmInstance.recast_wasm).toHaveBeenCalledWith(
      JSON.stringify(modifiedAst)
    )
  })
})

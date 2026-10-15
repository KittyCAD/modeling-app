import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { assertParse, nodePathFromRange } from '@src/lang/wasm'
import { getOperationVariableName } from '@src/lib/operations'
import { createSceneGraphDelta } from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { expect, it, vi } from 'vitest'

const code = '@settings(kclVersion = 3.0)\nsketch001 = sketch(on = XY) {}\n'

it('syncs a new sketch name even when linting is disabled', async () => {
  const { instance, kclManager } = await buildTheWorldAndNoEngineConnection()
  try {
    await vi.waitFor(() =>
      expect(kclManager.kclProgramVersionSignal.value).not.toBeNull()
    )
    const program = assertParse(code, instance)
    const sourceRange: [number, number, number] = [
      code.indexOf('sketch(on'),
      code.indexOf('}') + 1,
      0,
    ]
    const nodePath = await nodePathFromRange(program, sourceRange, instance)
    if (!nodePath) throw new Error('Expected sketch node path')
    const operation: Operation = {
      type: 'GroupBegin',
      group: { type: 'SketchBlock', sketchId: 1 },
      sourceRange,
      nodePath,
    }
    const delta = createSceneGraphDelta([])
    delta.exec_outcome.operations.map[0] = [operation, { type: 'GroupEnd' }]

    expect(kclManager.ast.body).toHaveLength(0)
    kclManager.updateCodeEditor(code, { shouldWriteToDisk: false })
    kclManager.syncSketchSolveOutcome(code, delta, {
      refreshLintDiagnostics: false,
    })

    await vi.waitFor(() =>
      expect(
        getOperationVariableName(operation, kclManager.ast, instance)
      ).toBe('sketch001')
    )
    expect(kclManager.variables).toEqual({})
  } finally {
    kclManager.close()
  }
})

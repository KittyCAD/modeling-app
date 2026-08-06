import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import {
  applyOperationCallbacksToOperationsByModule,
  defaultNodePath,
  type OperationsByModule,
} from '@src/lang/wasm'
import { expect, it } from 'vitest'

function createOperation(name: string, index: number): Operation {
  return {
    type: 'VariableDeclaration',
    name,
    value: {
      type: 'Number',
      value: index,
      ty: { type: 'Unknown' },
    },
    visibility: 'default',
    nodePath: defaultNodePath(),
    sourceRange: [index, index + 1, 0],
  }
}

it('applies operation callbacks in one immutable batch', () => {
  const original = createOperation('original', 0)
  const untouched = [createOperation('untouched', 1)]
  const operationsByModule: OperationsByModule = {
    map: {
      3: [original],
      9: untouched,
    },
  }
  const firstReplacement = createOperation('firstReplacement', 2)
  const finalReplacement = createOperation('finalReplacement', 3)
  const appended = createOperation('appended', 4)
  const otherModule = createOperation('otherModule', 5)

  const next = applyOperationCallbacksToOperationsByModule({
    operationsByModule,
    callbacks: [
      { moduleId: 3, operation: firstReplacement, index: 0 },
      { moduleId: 3, operation: appended, index: 1 },
      { moduleId: 7, operation: otherModule, index: 0 },
      { moduleId: 3, operation: finalReplacement, index: 0 },
    ],
  })

  expect(next.map[3]).toEqual([finalReplacement, appended])
  expect(next.map[7]).toEqual([otherModule])
  expect(next.map[9]).toBe(untouched)
  expect(operationsByModule.map).toEqual({
    3: [original],
    9: untouched,
  })
})

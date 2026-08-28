import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { OperationsByModule } from '@rust/kcl-lib/bindings/OperationsByModule'
import {
  buildOperationTree,
  operationIcon,
  operationLabel,
} from '@src/features/featureTree/operationTree'
import { describe, expect, it } from 'vitest'

const range = (from: number, to: number) =>
  [from, to, 0] as [number, number, number]
const path = (from: number) => ({
  steps: [{ type: 'ProgramBodyItem' as const, index: from }],
})

const call = (name: string, from: number): Operation => ({
  type: 'StdLibCall',
  name,
  unlabeledArg: null,
  labeledArgs: {},
  nodePath: path(from),
  sourceRange: range(from, from + name.length),
})

const operations = (map: OperationsByModule['map']): OperationsByModule => ({
  map,
})

describe('feature tree operations', () => {
  it('nests operations inside sketch blocks and omits hide calls', () => {
    const tree = buildOperationTree(
      operations({
        0: [
          {
            type: 'GroupBegin',
            group: { type: 'SketchBlock', sketchId: 1 },
            nodePath: path(0),
            sourceRange: range(0, 30),
          },
          call('startProfileAt', 10),
          call('hide', 20),
          { type: 'GroupEnd' },
          call('extrude', 31),
        ],
      })
    )

    expect(tree.map((item) => operationLabel(item.operation))).toEqual([
      'Sketch',
      'Extrude',
    ])
    expect(
      tree[0].children.map((item) => operationLabel(item.operation))
    ).toEqual(['Start Profile At'])
  })

  it('expands a module only once and does not recurse through cycles', () => {
    const module = (from: number): Operation => ({
      type: 'ModuleInstance',
      name: 'bracket',
      moduleId: 2,
      nodePath: path(from),
      sourceRange: range(from, from + 1),
    })
    const tree = buildOperationTree(
      operations({
        0: [module(0), module(2)],
        2: [module(4), call('fillet', 5)],
      })
    )

    expect(tree[0].children).toHaveLength(2)
    expect(tree[0].children[0].children).toHaveLength(0)
    expect(tree[1].children).toHaveLength(0)
  })

  it('uses CAD glyphs when the operation has one', () => {
    expect(operationIcon(call('extrude', 0))).toBe('extrude')
    expect(operationIcon(call('somethingNew', 0))).toBe('command')
  })
})

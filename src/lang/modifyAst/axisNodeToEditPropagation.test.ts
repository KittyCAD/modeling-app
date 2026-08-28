import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createMemberExpression,
  createVariableDeclaration,
} from '@src/lang/create'
import { addHelix } from '@src/lang/modifyAst/geometry'
import { addRevolve } from '@src/lang/modifyAst/sweeps'
import type * as QueryAst from '@src/lang/queryAst'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { describe, expect, it, vi } from 'vitest'

const getVariableExprsFromSelection = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLibCommands', () => ({
  STD_LIB_COMMANDS: {},
}))

vi.mock('@src/lang/queryAst', async (importOriginal) => {
  const original = await importOriginal<typeof QueryAst>()
  return {
    ...original,
    getVariableExprsFromSelection,
  }
})

describe('edge-axis edit propagation', () => {
  const wasmInstance = {} as ModuleType
  const edge = {
    graphSelections: [
      {
        artifact: { type: 'sweepEdge' },
        codeRef: { range: [0, 0, 0], pathToNode: [] },
      },
    ],
    otherSelections: [],
  } as unknown as Selections
  const sketches = {
    graphSelections: [
      {
        artifact: { type: 'path' },
        codeRef: { range: [0, 0, 0], pathToNode: [] },
      },
    ],
    otherSelections: [],
  } as unknown as Selections
  const commandValue = (value: number): KclCommandValue => ({
    valueAst: createLiteral(value, wasmInstance),
    valueText: String(value),
    valueCalculated: String(value),
  })

  const ast = (): Node<Program> => ({
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    body: [
      createVariableDeclaration('profile001', createLiteral(0, wasmInstance)),
      createVariableDeclaration(
        'helix001',
        createCallExpressionStdLibKw('helix', null, [])
      ),
      createVariableDeclaration(
        'revolve001',
        createCallExpressionStdLibKw(
          'revolve',
          createLocalName('profile001'),
          []
        )
      ),
    ],
    nonCodeMeta: { nonCodeNodes: {}, startNodes: [] },
  })
  const helixPath: PathToNode = [
    ['body', ''],
    [1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
  ]
  const revolvePath: PathToNode = [
    ['body', ''],
    [2, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
  ]

  function expectEdgeResolverToReceiveNodeToEdit() {
    getVariableExprsFromSelection.mockImplementation(
      (
        selection: Selections,
        _graph: ArtifactGraph,
        _ast,
        _wasm,
        nodeToEdit
      ) => {
        if (selection.graphSelections[0]?.artifact?.type === 'sweepEdge') {
          return nodeToEdit
            ? {
                exprs: [createMemberExpression('body001', 'axisEdge')],
              }
            : new Error('Edge resolution requires the edit path')
        }
        return { exprs: [createLocalName('profile001')] }
      }
    )
  }

  it('forwards the Helix edit path while resolving an edge axis', () => {
    expectEdgeResolverToReceiveNodeToEdit()
    const result = addHelix({
      ast: ast(),
      artifactGraph: new Map(),
      edge,
      revolutions: commandValue(2),
      angleStart: commandValue(0),
      radius: commandValue(10),
      nodeToEdit: helixPath,
      wasmInstance,
    })

    expect(err(result)).toBe(false)
    if (err(result)) {
      throw result
    }
    const edited = result.modifiedAst.body[1]
    expect(edited.type).toBe('VariableDeclaration')
    if (edited.type !== 'VariableDeclaration') {
      throw new Error('Expected Helix')
    }
    const init = edited.declaration.init
    expect(init.type).toBe('CallExpressionKw')
    if (init.type !== 'CallExpressionKw') {
      throw new Error('Expected Helix call')
    }
    expect(init.arguments).toContainEqual(
      createLabeledArg('axis', createMemberExpression('body001', 'axisEdge'))
    )
  })

  it('forwards the Revolve edit path while resolving an edge axis', () => {
    expectEdgeResolverToReceiveNodeToEdit()
    const result = addRevolve({
      ast: ast(),
      artifactGraph: new Map(),
      sketches,
      edge,
      angle: commandValue(180),
      nodeToEdit: revolvePath,
      wasmInstance,
    })

    expect(err(result)).toBe(false)
    if (err(result)) {
      throw result
    }
    const edited = result.modifiedAst.body[2]
    expect(edited.type).toBe('VariableDeclaration')
    if (edited.type !== 'VariableDeclaration') {
      throw new Error('Expected Revolve')
    }
    const init = edited.declaration.init
    expect(init.type).toBe('CallExpressionKw')
    if (init.type !== 'CallExpressionKw') {
      throw new Error('Expected Revolve call')
    }
    expect(init.arguments).toContainEqual(
      createLabeledArg('axis', createMemberExpression('body001', 'axisEdge'))
    )
  })
})

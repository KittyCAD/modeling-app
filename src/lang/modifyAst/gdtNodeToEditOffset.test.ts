import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
} from '@src/lang/create'
import {
  addAngularityGdt,
  addParallelismGdt,
  addPerpendicularityGdt,
} from '@src/lang/modifyAst/gdt'
import type {
  Expr,
  PathToNode,
  Program,
  VariableDeclaration,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const modifyAstWithTagsForSelection = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLibCommands', () => ({
  STD_LIB_COMMANDS: {},
}))

vi.mock('@src/lang/modifyAst/tagManagement', () => ({
  modifyAstWithTagsForSelection,
}))

describe('GDT datum edit path offsets', () => {
  const wasmInstance = {} as ModuleType
  const gdtModulePath = [createIdentifier('gdt')]
  const nodeToEdit: PathToNode = [
    ['body', ''],
    [1, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', 'VariableDeclarator'],
  ]
  const objects = {
    graphSelections: [
      {
        artifact: { type: 'cap' },
        codeRef: { range: [0, 0, 0], pathToNode: [] },
      },
    ],
    otherSelections: [],
  } as unknown as Selections

  beforeEach(() => {
    modifyAstWithTagsForSelection.mockImplementation(
      (modifiedAst: Node<Program>) => ({
        modifiedAst,
        exprs: [createLocalName('face001')],
      })
    )
  })

  const commandValue = (value: Node<Expr>): KclCommandValue => ({
    valueAst: value,
    valueText: '',
    valueCalculated: '',
  })

  const namedCommandValue = (
    variableName: string,
    value: Node<Expr>
  ): KclCommandValue =>
    ({
      ...commandValue(value),
      variableName,
      variableDeclarationAst: createVariableDeclaration(variableName, value),
      variableIdentifierAst: createLocalName(variableName),
      insertIndex: 0,
    })

  const astWithSourceBeforeGdt = (callee: string): Node<Program> => ({
    start: 0,
    end: 0,
    moduleId: 0,
    outerAttrs: [],
    preComments: [],
    commentStart: 0,
    body: [
      createVariableDeclaration(
        'source001',
        createCallExpressionStdLibKw('extrude', createLocalName('profile001'), [
          createLabeledArg('length', createLiteral(1, wasmInstance)),
        ])
      ),
      createVariableDeclaration(
        'gdt001',
        createCallExpressionStdLibKw(
          callee,
          null,
          [
            createLabeledArg(
              'faces',
              createArrayExpression([createLocalName('oldFace')])
            ),
            createLabeledArg('tolerance', createLiteral(0.1, wasmInstance)),
          ],
          undefined,
          gdtModulePath
        )
      ),
    ],
    nonCodeMeta: { nonCodeNodes: {}, startNodes: [] },
  })

  const sourceCallName = (ast: Node<Program>) => {
    const declaration = ast.body[1] as Node<VariableDeclaration>
    const init = declaration.declaration.init
    if (init.type !== 'CallExpressionKw') {
      throw new Error('Expected source call')
    }
    return init.callee.name.name
  }

  const editedGdtCall = (ast: Node<Program>) => {
    const declaration = ast.body[2] as Node<VariableDeclaration>
    const init = declaration.declaration.init
    if (init.type !== 'CallExpressionKw') {
      throw new Error('Expected GDT call')
    }
    return init
  }

  it.each([
    ['perpendicularity', addPerpendicularityGdt],
    ['angularity', addAngularityGdt],
    ['parallelism', addParallelismGdt],
  ])(
    'keeps %s edit targeting after inserting a named datums value',
    (callee, addGdt) => {
      const datums = namedCommandValue(
        'datums001',
        createArrayExpression([
          createLiteral('A', wasmInstance),
          createLiteral('B', wasmInstance),
        ])
      )

      const result = addGdt({
        ast: astWithSourceBeforeGdt(callee),
        artifactGraph: new Map(),
        objects,
        datums,
        tolerance: commandValue(createLiteral(0.1, wasmInstance)),
        wasmInstance,
        nodeToEdit,
      })

      expect(err(result)).toBe(false)
      if (err(result)) {
        throw result
      }

      expect(result.modifiedAst.body[0]).toMatchObject({
        type: 'VariableDeclaration',
        declaration: { id: { name: 'datums001' } },
      })
      expect(sourceCallName(result.modifiedAst)).toBe('extrude')

      const gdtCall = editedGdtCall(result.modifiedAst)
      expect(gdtCall.callee.name.name).toBe(callee)
      expect(gdtCall.arguments).toContainEqual(
        createLabeledArg('datums', createLocalName('datums001'))
      )
    }
  )
})

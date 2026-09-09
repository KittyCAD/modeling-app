import {
  createArrayExpression,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
} from '@src/lang/create'
import {
  addAngularityGdt,
  addParallelismGdt,
  addPerpendicularityGdt,
  addProfileGdt,
} from '@src/lang/modifyAst/gdt'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { assertParse, type PathToNode, recast } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const modifyAstWithTagsForSelection = vi.hoisted(() => vi.fn())

vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLibCommands', () => ({
  STD_LIB_COMMANDS: {},
}))

vi.mock('@src/lang/modifyAst/tagManagement', () => ({
  modifyAstWithTagsForSelection,
}))

describe('GDT datum edit path offsets', () => {
  let wasmInstance: ModuleType
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

  beforeAll(async () => {
    const world = await buildTheWorldAndNoEngineConnection()
    wasmInstance = world.instance
  })

  beforeEach(() => {
    modifyAstWithTagsForSelection.mockImplementation((modifiedAst) => ({
      modifiedAst,
      exprs: [createLocalName('face001')],
    }))
  })

  it.each([
    ['profileLine', 'edges', 'edgeId(body001, index = 4)'],
    ['profileSurface', 'faces', 'faceId(body001, index = 4)'],
  ] as const)(
    'preserves the %s selection when editing tolerance and style',
    (profileFunction, targetArgument, target) => {
      const call = `gdt::${profileFunction}(${targetArgument} = [${target}], tolerance = 0.1, fontSize = 12)`
      const code = `@settings(kclVersion = 2.0)\nannotation001 = ${call}`
      const ast = assertParse(code, wasmInstance)
      const makeValue = (value: number): KclCommandValue => ({
        valueAst: createLiteral(value, wasmInstance),
        valueText: String(value),
        valueCalculated: String(value),
      })
      const nodeToEdit = getNodePathFromSourceRange(ast, [
        code.indexOf(call),
        code.length,
        0,
      ])
      const result = addProfileGdt({
        ast,
        artifactGraph: new Map(),
        profileFunction,
        tolerance: makeValue(0.2),
        fontSize: makeValue(16),
        nodeToEdit,
        wasmInstance,
      })
      if (err(result)) throw result

      expect(recast(result.modifiedAst, wasmInstance)).toEqual(
        recast(
          assertParse(
            code
              .replace('tolerance = 0.1', 'tolerance = 0.2')
              .replace('fontSize = 12', 'fontSize = 16'),
            wasmInstance
          ),
          wasmInstance
        )
      )
      expect(result.pathToNode).toEqual(nodeToEdit)
      expect(recast(ast, wasmInstance)).toEqual(
        recast(assertParse(code, wasmInstance), wasmInstance)
      )
    }
  )

  it.each([
    ['perpendicularity', addPerpendicularityGdt],
    ['angularity', addAngularityGdt],
    ['parallelism', addParallelismGdt],
  ] as const)(
    'keeps the %s edit target after inserting a named datums value',
    (callee, addGdt) => {
      const datumValues = createArrayExpression([
        createLiteral('A', wasmInstance),
        createLiteral('B', wasmInstance),
      ])
      const datums: KclCommandValue = {
        valueAst: datumValues,
        valueText: '',
        valueCalculated: '',
        variableName: 'datums001',
        variableDeclarationAst: createVariableDeclaration(
          'datums001',
          datumValues
        ),
        variableIdentifierAst: createLocalName('datums001'),
        insertIndex: 0,
      }
      const tolerance: KclCommandValue = {
        valueAst: createLiteral(0.1, wasmInstance),
        valueText: '0.1',
        valueCalculated: '0.1',
      }
      const ast = assertParse(
        `source001 = extrude(profile001, length = 1)\n` +
          `gdt001 = gdt::${callee}(faces = [oldFace], tolerance = 0.1)`,
        wasmInstance
      )

      const result = addGdt({
        ast,
        artifactGraph: new Map(),
        objects,
        datums,
        tolerance,
        wasmInstance,
        nodeToEdit,
      })
      if (err(result)) {
        throw result
      }

      const code = recast(result.modifiedAst, wasmInstance)
      expect(code).toContain('datums001 = ["A", "B"]')
      expect(code).toContain('source001 = extrude(profile001, length = 1)')
      expect(code).toContain(`gdt001 = gdt::${callee}(`)
      expect(code).toContain('datums = datums001')
    }
  )
})

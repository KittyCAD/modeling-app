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
} from '@src/lang/modifyAst/gdt'
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

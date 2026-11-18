import type { Node } from '@rust/kcl-lib/bindings/Node'
import type * as WasmUtilsModule from '@src/lang/wasmUtils'
import type { KclManager } from '@src/lang/KclManager'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import {
  createLiteral,
  createLocalName,
  createVariableDeclaration,
} from '@src/lang/create'
import { deleteSegmentOrProfileFromPipeExpression } from '@src/lang/modifyAst'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { getConstraintInfoKw } from '@src/lang/std/sketch'
import {
  removeSingleConstraint,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'
import {
  assertParse,
  recast,
  type CallExpressionKw,
  type Expr,
  type Program,
} from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { modelingMachine } from '@src/machines/modelingMachine'
import { legacySketchCases } from '@src/machines/modelingMachine.legacySketch.fixtures'
import type { SketchDetails } from '@src/machines/modelingSharedTypes'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import fc from 'fast-check'
import { join } from 'path'

// Registry imports can request the browser Wasm loader. Load the same real blob
// from disk; these tests use parsing and AST editing only, never KCL execution.
vi.mock('@src/lang/wasmUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof WasmUtilsModule>()),
  initialiseWasm: async () => {
    const [{ loadAndInitialiseWasmInstance }, path] = await Promise.all([
      import('@src/lang/wasmUtilsNode'),
      import('path'),
    ])
    return loadAndInitialiseWasmInstance(
      path.join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
    )
  },
}))

// A future actor change must not silently turn these into execution tests.
vi.mock('@src/lang/executeAstMock', () => ({
  executeAstMock: () => {
    throw new Error('AST tests must not execute KCL')
  },
  evaluateExpression: () => {
    throw new Error('AST tests must not evaluate KCL')
  },
}))

let instance: ModuleType
beforeAll(async () => {
  instance = await loadAndInitialiseWasmInstance(
    join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
  )
})

const cases = Object.values(legacySketchCases)

function parseSegment(code: string, searchText: string) {
  const ast = assertParse(code, instance)
  const start = code.indexOf(searchText)
  if (start < 0) throw new Error(`Missing source: ${searchText}`)
  const path = getNodePathFromSourceRange(ast, [
    start,
    start + searchText.length,
    0,
  ])
  const call = getNodeFromPath<Node<CallExpressionKw>>(
    ast,
    path,
    instance,
    'CallExpressionKw'
  )
  if (isErr(call)) throw call
  return { ast, call: call.node, path: call.shallowPath }
}

function statementPath(ast: Node<Program>, name: string) {
  const statement = ast.body.find(
    (item) =>
      item.type === 'VariableDeclaration' && item.declaration.id.name === name
  )
  if (!statement) throw new Error(`Missing declaration: ${name}`)
  return getNodePathFromSourceRange(ast, [statement.start, statement.end, 0])
}

async function applyNamedDimension(
  code: string,
  searchText: string,
  constraintIndex: number,
  filter?: string,
  value = 20
) {
  const { ast, call, path } = parseSegment(code, searchText)
  const constraint = getConstraintInfoKw(call, code, path, filter)[
    constraintIndex
  ]
  const sketchPath = statementPath(ast, 'profile001')
  const planePath = statementPath(ast, 'sketch001')
  const sketchDetails: SketchDetails = {
    sketchEntryNodePath: sketchPath,
    sketchNodePaths: [sketchPath],
    planeNodePath: planePath,
    zAxis: [0, 0, 1],
    yAxis: [0, 1, 0],
    origin: [0, 0, 0],
  }
  let persistedCode = ''
  let editedAst = ast
  // The scene boundary intentionally does not execute or rebuild geometry.
  // The production actor still computes the AST, reference paths, and selections.
  const sceneEdit = vi.fn<SceneEntities['updateAstAndRejigSketch']>(
    async (_entry, _sketches, _plane, nextAst) => {
      if (isErr(nextAst)) throw nextAst
      editedAst = nextAst
      return { newAst: nextAst }
    }
  )
  const kclManager = {
    ast,
    artifactGraph: new Map(),
    sceneEntitiesManager: { updateAstAndRejigSketch: sceneEdit },
    updateEditorWithAstAndWriteToFile: async (nextAst: Node<Program>) => {
      const code = recast(nextAst, instance)
      if (isErr(code)) throw code
      persistedCode = code
    },
  } as unknown as KclManager
  const implementation =
    modelingMachine.implementations.actors['Apply named value constraint']
  const logic = 'src' in implementation ? implementation.src : implementation
  const actor = createActor(logic, {
    input: {
      kclManager,
      wasmInstance: instance,
      sketchDetails,
      selectionRanges: { graphSelections: [], otherSelections: [] },
      data: {
        currentValue: {
          valueText: constraint.value,
          pathToNode: constraint.pathToNode,
          variableName: 'test_variable',
        },
        namedValue: {
          valueText: String(value),
          valueCalculated: String(value),
          variableName: 'test_variable',
          insertIndex: 0,
          variableDeclarationAst: createVariableDeclaration(
            'test_variable',
            createLiteral(value, instance)
          ),
          variableIdentifierAst: createLocalName('test_variable'),
          valueAst: createLiteral(value, instance),
        },
      },
    },
  })
  try {
    const done = toPromise(actor)
    actor.start()
    const result = await done
    return { code: persistedCode, ast: editedAst, result }
  } finally {
    actor.stop()
  }
}

describe('naming legacy dimensions without executing KCL', () => {
  it.each(cases.flatMap((c) => c.namedConstantConstraint))(
    '$name',
    async ({ code, searchText, constraintIndex, expectedResult, filter }) => {
      const edited = await applyNamedDimension(
        code,
        searchText,
        constraintIndex,
        filter
      )
      expect(edited.code).toContain(expectedResult)
      expect(edited.code).toContain('test_variable = 20')
      assertParse(edited.code, instance)
      const selectedPath =
        edited.result.selection.graphSelections[0]?.codeRef?.pathToNode
      if (!selectedPath)
        throw new Error('Missing selection after naming the dimension')
      const selected = getNodeFromPath<Expr>(edited.ast, selectedPath, instance)
      if (isErr(selected)) throw selected
      expect(selected.node).toMatchObject({
        type: 'Name',
        name: { name: 'test_variable' },
      })
      const sketch = getNodeFromPath(
        edited.ast,
        edited.result.updatedSketchEntryNodePath,
        instance,
        'VariableDeclaration'
      )
      if (isErr(sketch)) throw sketch
      expect(sketch.node).toMatchObject({
        declaration: { id: { name: 'profile001' } },
      })
    }
  )

  it('changes only the selected coordinate and keeps the inserted dimension numeric', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          x: fc.integer({ min: -500, max: 500 }),
          y: fc.integer({ min: -500, max: 500 }),
          value: fc.integer({ min: -500, max: 500 }),
          axis: fc.constantFrom(0, 1),
          absolute: fc.boolean(),
        }),
        async ({ x, y, value, axis, absolute }) => {
          const argument = absolute ? 'endAbsolute' : 'end'
          const target = `line(${argument} = [${x}, ${y}])`
          const code = `@settings(kclVersion = 1.0)
untouched = 123
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> ${target}
  |> line(end = [7, 11])
`
          const edited = await applyNamedDimension(
            code,
            target,
            axis,
            undefined,
            value
          )
          const expected = `test_variable = ${value}\n${code.replace(target, `line(${argument} = [${axis === 0 ? 'test_variable' : x}, ${axis === 1 ? 'test_variable' : y}])`)}`
          expect(edited.code).toBe(
            recast(assertParse(expected, instance), instance)
          )
        }
      ),
      { numRuns: 50 }
    )
  })
})

describe('deleting independent legacy segments without executing KCL', () => {
  it.each(cases.flatMap((c) => c.deleteSegment))(
    '$name',
    ({ code, searchText }) => {
      const { ast, path } = parseSegment(code, searchText)
      const original = structuredClone(ast)
      const edited = deleteSegmentOrProfileFromPipeExpression(
        [],
        ast,
        {},
        code,
        [path],
        getConstraintInfoKw,
        removeSingleConstraint,
        transformAstSketchLines,
        instance
      )
      if (isErr(edited)) throw edited
      const expected = code.replace(`|> ${searchText}\n`, '')
      expect(recast(edited, instance)).toBe(
        recast(assertParse(expected, instance), instance)
      )
      expect(ast).toEqual(original)
    }
  )
})

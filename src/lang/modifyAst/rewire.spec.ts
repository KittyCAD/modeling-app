import { join } from 'node:path'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { rewireAfterDelete } from '@src/lang/modifyAst/rewire'
import { parse, recast } from '@src/lang/wasm'
import type { Program } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, describe, expect, it } from 'vitest'

const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
let instanceInThisFile: ModuleType | undefined

beforeAll(async () => {
  instanceInThisFile = await loadAndInitialiseWasmInstance(WASM_PATH)
})

const getInstance = (): ModuleType => {
  if (!instanceInThisFile) {
    throw new Error('Expected wasm instance to be initialized')
  }
  return instanceInThisFile
}

const parseProgram = (code: string): Node<Program> => {
  const result = parse(code, getInstance())
  if (err(result)) {
    throw result
  }
  if (!result.program) {
    throw new Error('Expected parse to return a program')
  }
  return result.program
}

const getVariableInitializer = (ast: Node<Program>, variableName: string) => {
  const declaration = ast.body.find(
    (statement) =>
      statement.type === 'VariableDeclaration' &&
      statement.declaration.id.name === variableName
  )

  if (!declaration || declaration.type !== 'VariableDeclaration') {
    throw new Error(`Expected variable declaration for "${variableName}"`)
  }

  return declaration.declaration.init
}

describe('rewireAfterDelete', () => {
  it('rewires downstream references to deleted feature parent', () => {
    const beforeDeleteAst = parseProgram(`sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 6.91)
extrude001 = extrude(profile001, length = 5)
hole001 = hole::hole(
  extrude001,
  face = END,
  cutAt = [3, 0],
  holeBottom = hole::flat(),
  holeBody = hole::blind(depth = 2, diameter = 3),
  holeType = hole::simple(),
)
hole002 = hole::hole(
  hole001,
  face = END,
  cutAt = [-3, 0],
  holeBottom = hole::flat(),
  holeBody = hole::blind(depth = 2, diameter = 3),
  holeType = hole::simple(),
)`)

    const afterDeleteAst = parseProgram(`sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 6.91)
extrude001 = extrude(profile001, length = 5)
hole002 = hole::hole(
  hole001,
  face = END,
  cutAt = [-3, 0],
  holeBottom = hole::flat(),
  holeBody = hole::blind(depth = 2, diameter = 3),
  holeType = hole::simple(),
)`)

    const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)
    const hole002Init = getVariableInitializer(rewiredAst, 'hole002')
    expect(hole002Init.type).toBe('CallExpressionKw')

    if (hole002Init.type !== 'CallExpressionKw') {
      throw new Error('Expected hole002 initializer to be a call expression')
    }
    expect(hole002Init.unlabeled).not.toBeNull()
    expect(hole002Init.unlabeled?.type).toBe('Name')

    if (!hole002Init.unlabeled || hole002Init.unlabeled.type !== 'Name') {
      throw new Error(
        'Expected hole002 call to have an unlabeled Name argument'
      )
    }
    expect(hole002Init.unlabeled.name.name).toBe('extrude001')
  })

  it('rewires a deleted reference through intermediate deleted parents', () => {
    const beforeDeleteAst = parseProgram(`sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 5)
extrude001 = extrude(profile001, length = 5)
result001 = fillet(extrude001, radius = 1)`)

    const afterDeleteAst = parseProgram(`sketch001 = startSketchOn(XY)
result001 = fillet(extrude001, radius = 1)`)

    const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)
    const result001Init = getVariableInitializer(rewiredAst, 'result001')
    expect(result001Init.type).toBe('CallExpressionKw')

    if (result001Init.type !== 'CallExpressionKw') {
      throw new Error('Expected result001 initializer to be a call expression')
    }
    expect(result001Init.unlabeled).not.toBeNull()
    expect(result001Init.unlabeled?.type).toBe('Name')

    if (!result001Init.unlabeled || result001Init.unlabeled.type !== 'Name') {
      throw new Error(
        'Expected result001 call to have an unlabeled Name argument'
      )
    }
    expect(result001Init.unlabeled.name.name).toBe('sketch001')
  })

  it('does not rewrite when deleted feature has no parent reference', () => {
    const beforeDeleteAst = parseProgram(`deleted001 = 5
keep001 = deleted001 + 1`)

    const afterDeleteAst = parseProgram(`keep001 = deleted001 + 1`)

    const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)

    expect(rewiredAst).toBe(afterDeleteAst)
    expect(recast(rewiredAst, getInstance())).toContain(
      'keep001 = deleted001 + 1'
    )
  })
})

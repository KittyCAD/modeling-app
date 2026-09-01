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

  // App repro: create an extrusion and a function parameter with the same name,
  // then remove the extrusion in the Feature Tree. The local reference is
  // incorrectly rewired to its region.
  it('does not rewire a function parameter that shadows a deleted feature', () => {
    const beforeDeleteAst = parseProgram(`parent001 = 1
deleted001 = parent001
fn keepLocal(deleted001) {
  copy = deleted001
  return copy
}`)

    const afterDeleteAst = parseProgram(`parent001 = 1
fn keepLocal(deleted001) {
  copy = deleted001
  return copy
}`)

    const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)

    expect(recast(rewiredAst, getInstance())).toContain('copy = deleted001')
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

  // Sketch-block bodies are their own scope at runtime in every KCL version,
  // so these frames are not gated on the language version. Bare blocks share
  // the same path shape and are covered by the same rule.
  describe.each([
    ['2.0', '@settings(kclVersion = 2.0)'],
    ['3.0-preview', '@settings(kclVersion = "3.0-preview")'],
  ])('sketch block scope under KCL %s', (_version, header) => {
    it('does not rewire references shadowed by a sketch block binding', () => {
      const beforeDeleteAst = parseProgram(`${header}
sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 5)
extrude001 = extrude(profile001, length = 5)
profile002 = sketch(on = XY) {
  extrude001 = circle(start = [var 1, var 0], center = [var 0, var 0])
  coincident([extrude001.center, ORIGIN])
}
result001 = fillet(extrude001, radius = 1)`)

      const afterDeleteAst = parseProgram(`${header}
sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 5)
profile002 = sketch(on = XY) {
  extrude001 = circle(start = [var 1, var 0], center = [var 0, var 0])
  coincident([extrude001.center, ORIGIN])
}
result001 = fillet(extrude001, radius = 1)`)

      const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)
      const recasted = recast(rewiredAst, getInstance())

      // The block-local extrude001 shadows the deleted feature inside the
      // body, but the reference after the block refers to the deleted
      // top-level feature and must be rewired.
      expect(recasted).toContain('coincident([extrude001.center, ORIGIN])')
      expect(recasted).toContain('fillet(profile001, radius = 1)')
    })

    it('rewires a sketch block argument referencing the deleted feature', () => {
      const beforeDeleteAst = parseProgram(`${header}
plane001 = offsetPlane(XY, offset = 5)
profile001 = sketch(on = plane001) {
  circle1 = circle(start = [var 1, var 0], center = [var 0, var 0])
}`)

      const afterDeleteAst = parseProgram(`${header}
profile001 = sketch(on = plane001) {
  circle1 = circle(start = [var 1, var 0], center = [var 0, var 0])
}`)

      const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)

      // Sketch block arguments are evaluated in the enclosing scope.
      expect(recast(rewiredAst, getInstance())).toContain('sketch(on = XY)')
    })

    it('rewires references in a sibling statement after the sketch block', () => {
      const beforeDeleteAst = parseProgram(`${header}
sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 5)
extrude001 = extrude(profile001, length = 5)
fn wrap() {
  profile002 = sketch(on = XY) {
    extrude001 = circle(start = [var 1, var 0], center = [var 0, var 0])
  }
  result001 = fillet(extrude001, radius = 1)
  return result001
}`)

      const afterDeleteAst = parseProgram(`${header}
sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 5)
fn wrap() {
  profile002 = sketch(on = XY) {
    extrude001 = circle(start = [var 1, var 0], center = [var 0, var 0])
  }
  result001 = fillet(extrude001, radius = 1)
  return result001
}`)

      const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)

      // The block frame is discarded when traversal moves to the next
      // statement in the function body, so the reference there sees only the
      // deleted top-level feature.
      expect(recast(rewiredAst, getInstance())).toContain(
        'fillet(profile001, radius = 1)'
      )
    })
  })
})

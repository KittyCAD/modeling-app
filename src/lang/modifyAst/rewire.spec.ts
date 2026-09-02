import { join } from 'node:path'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { programUsesKclV3 } from '@src/lang/kclLanguageVersion'
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

  it("rewires a KCL 2 sketch-block shadow's own initializer", () => {
    const beforeDeleteAst = parseProgram(`@settings(kclVersion = 2.0)
parent001 = 10
deleted001 = parent001
result = if false {
  profile001 = sketch(on = XY) {
    deleted001 = deleted001 + 1
    line001 = line(start = [var 0, var 0], end = [var 1, var 0])
  }
  1
} else {
  0
}`)

    const afterDeleteAst = parseProgram(`@settings(kclVersion = 2.0)
parent001 = 10
result = if false {
  profile001 = sketch(on = XY) {
    deleted001 = deleted001 + 1
    line001 = line(start = [var 0, var 0], end = [var 1, var 0])
  }
  1
} else {
  0
}`)

    const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)
    const recasted = recast(rewiredAst, getInstance())
    if (err(recasted)) {
      throw recasted
    }

    // A sketch-block declaration is not in scope in its own initializer,
    // including under KCL 2. Leaving this reference unchanged creates a
    // latent runtime error if the currently inactive arm is later selected.
    expect(recasted).toContain('deleted001 = parent001 + 1')
  })

  // KCL 3.0: each if/else-if/else arm body is its own scope, and a binding is
  // in scope only from its declaration to the arm's closing brace.
  describe('if-arm scope under KCL 3.0', () => {
    const V3_HEADER = '@settings(kclVersion = "3.0-preview")'
    const V3_OPTIONS = { useV3ArmScoping: true }

    const rewireV3 = (beforeCode: string, afterCode: string): string => {
      const beforeDeleteAst = parseProgram(`${V3_HEADER}
parent001 = 1
deleted001 = parent001 + 1
${beforeCode}`)
      const afterDeleteAst = parseProgram(`${V3_HEADER}
parent001 = 1
${afterCode}`)
      const rewiredAst = rewireAfterDelete(
        beforeDeleteAst,
        afterDeleteAst,
        V3_OPTIONS
      )
      const recasted = recast(rewiredAst, getInstance())
      if (err(recasted)) {
        throw recasted
      }
      return recasted
    }

    it('does not rewire references after an arm-local shadow in the same arm', () => {
      const code = `result = if true {
  deleted001 = 100
  deleted001 + 1
} else {
  0
}`
      const recasted = rewireV3(code, code)

      expect(recasted).toContain('deleted001 + 1')
      expect(recasted).not.toContain('parent001 + 1')
    })

    it('rewires references before the shadow declaration in the same arm', () => {
      const code = `result = if true {
  before001 = deleted001 + 1
  deleted001 = 100
  deleted001 + before001
} else {
  0
}`
      const recasted = rewireV3(code, code)

      // The binding is not in scope yet at the earlier reference.
      expect(recasted).toContain('before001 = parent001 + 1')
      // After the declaration, the shadow wins.
      expect(recasted).toContain('deleted001 + before001')
    })

    it('keeps arms independent of a sibling arm shadow', () => {
      const code = `result = if true {
  deleted001 = 100
  deleted001 + 1
} else if false {
  deleted001 + 2
} else {
  deleted001 + 3
}`
      const recasted = rewireV3(code, code)

      // Shadowed in the first arm, unshadowed in its siblings.
      expect(recasted).toContain('deleted001 + 1')
      expect(recasted).toContain('parent001 + 2')
      expect(recasted).toContain('parent001 + 3')
    })

    it('rewires an else-if condition even when an earlier arm shadows', () => {
      const code = `result = if true {
  deleted001 = 100
  deleted001
} else if deleted001 > 0 {
  1
} else {
  2
}`
      const recasted = rewireV3(code, code)

      // Conditions are evaluated in the enclosing scope.
      expect(recasted).toContain('parent001 > 0')
    })

    it('rewires references after the if-expression', () => {
      const code = `result = if true {
  deleted001 = 100
  deleted001
} else {
  0
}
after001 = deleted001 + result`
      const recasted = rewireV3(code, code)

      expect(recasted).toContain('after001 = parent001 + result')
    })

    it('does not leak a nested arm shadow into the outer arm', () => {
      const code = `result = if true {
  inner = if true {
    deleted001 = 100
    deleted001
  } else {
    0
  }
  deleted001 + inner
} else {
  0
}`
      const recasted = rewireV3(code, code)

      expect(recasted).toContain('deleted001 = 100')
      expect(recasted).toContain('parent001 + inner')
    })

    it('rewires a reference after an if-expression inside a function', () => {
      const code = `fn build() {
  result = if true {
    deleted001 = 100
    deleted001
  } else {
    0
  }
  after001 = deleted001 + result
  return after001
}`
      const recasted = rewireV3(code, code)

      // The arm binding is dropped at the arm's closing brace instead of
      // leaking into the function scope.
      expect(recasted).toContain('after001 = parent001 + result')
    })

    it('does not capture a locally shadowed rewire target', () => {
      const beforeDeleteAst = parseProgram(`${V3_HEADER}
parent001 = 10
deleted001 = parent001
fn build() {
  parent001 = 100
  result = if true {
    deleted001 = 200
    deleted001
  } else {
    0
  }
  after001 = deleted001
  return after001
}
output = build()`)

      const afterDeleteAst = parseProgram(`${V3_HEADER}
parent001 = 10
fn build() {
  parent001 = 100
  result = if true {
    deleted001 = 200
    deleted001
  } else {
    0
  }
  after001 = deleted001
  return after001
}
output = build()`)

      const rewiredAst = rewireAfterDelete(
        beforeDeleteAst,
        afterDeleteAst,
        V3_OPTIONS
      )
      const recasted = recast(rewiredAst, getInstance())
      if (err(recasted)) {
        throw recasted
      }

      // The deleted binding referred to the top-level parent001. Replacing it
      // with the bare name here would instead capture the function-local
      // parent001 and silently change output from 10 to 100.
      expect(recasted).toContain('after001 = deleted001')
      expect(recasted).not.toContain('after001 = parent001')
    })

    it("rewires the shadow declaration's own initializer", () => {
      const code = `result = if true {
  deleted001 = deleted001 + 1
  deleted001
} else {
  0
}`
      const recasted = rewireV3(code, code)

      expect(recasted).toContain('deleted001 = parent001 + 1')
    })

    it("rewires a function-body shadow declaration's own initializer", () => {
      // Pins the KCL 3.0 declaration timing outside arms: the binding takes
      // effect after its initializer, in function bodies too.
      const code = `fn build() {
  deleted001 = deleted001 + 1
  return deleted001
}`
      const recasted = rewireV3(code, code)

      expect(recasted).toContain('deleted001 = parent001 + 1')
    })

    it('does not rewire a function parameter shadow', () => {
      const code = `fn keepLocal(deleted001) {
  copy = deleted001
  return copy
}`
      const recasted = rewireV3(code, code)

      expect(recasted).toContain('copy = deleted001')
    })
  })

  // Pre-3.0 entry points share the enclosing scope with arm bodies, so the
  // legacy behavior must stay exactly as it is today.
  describe('if-arm references under pre-3.0 KCL', () => {
    it('rewires in-arm and post-if references at top level', () => {
      const beforeDeleteAst = parseProgram(`parent001 = 1
deleted001 = parent001 + 1
result = if true {
  deleted001 = 100
  x = deleted001 + 1
  x
} else {
  0
}
after001 = deleted001 + 1`)

      const afterDeleteAst = parseProgram(`parent001 = 1
result = if true {
  deleted001 = 100
  x = deleted001 + 1
  x
} else {
  0
}
after001 = deleted001 + 1`)

      const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)
      const recasted = recast(rewiredAst, getInstance())

      expect(recasted).toContain('x = parent001 + 1')
      expect(recasted).toContain('after001 = parent001 + 1')
    })

    it('keeps the function-frame leak for arm declarations in functions', () => {
      const beforeDeleteAst = parseProgram(`parent001 = 1
deleted001 = parent001 + 1
fn build() {
  result = if true {
    deleted001 = 100
    deleted001
  } else {
    0
  }
  after001 = deleted001 + result
  return after001
}`)

      const afterDeleteAst = parseProgram(`parent001 = 1
fn build() {
  result = if true {
    deleted001 = 100
    deleted001
  } else {
    0
  }
  after001 = deleted001 + result
  return after001
}`)

      const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)

      // The arm declaration registers into the function scope pre-3.0, so
      // the post-if reference stays shadowed.
      expect(recast(rewiredAst, getInstance())).toContain(
        'after001 = deleted001 + result'
      )
    })

    it("does not rewire a function-body shadow declaration's own initializer", () => {
      const beforeDeleteAst = parseProgram(`parent001 = 1
deleted001 = parent001 + 1
fn build() {
  deleted001 = deleted001 + 1
  return deleted001
}`)

      const afterDeleteAst = parseProgram(`parent001 = 1
fn build() {
  deleted001 = deleted001 + 1
  return deleted001
}`)

      const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst)

      expect(recast(rewiredAst, getInstance())).toContain(
        'deleted001 = deleted001 + 1'
      )
    })
  })

  // Mirrors the deleteSelection wiring: the gate is derived from the
  // before-delete program's settings and passed through.
  describe('deriving the arm-scoping gate from program settings', () => {
    const beforeCode = (header: string) => `${header}
parent001 = 1
deleted001 = parent001 + 1
result = if true {
  deleted001 = 100
  local001 = deleted001 + 1
  local001
} else {
  0
}`
    const afterCode = (header: string) => `${header}
parent001 = 1
result = if true {
  deleted001 = 100
  local001 = deleted001 + 1
  local001
} else {
  0
}`

    it('applies arm scoping for a 3.0-preview program', () => {
      const beforeDeleteAst = parseProgram(
        beforeCode('@settings(kclVersion = "3.0-preview")')
      )
      const afterDeleteAst = parseProgram(
        afterCode('@settings(kclVersion = "3.0-preview")')
      )

      const useV3ArmScoping = programUsesKclV3(beforeDeleteAst, getInstance())
      expect(useV3ArmScoping).toBe(true)

      const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst, {
        useV3ArmScoping,
      })

      expect(recast(rewiredAst, getInstance())).toContain(
        'local001 = deleted001 + 1'
      )
    })

    it('keeps legacy behavior for a 2.0 program', () => {
      const beforeDeleteAst = parseProgram(
        beforeCode('@settings(kclVersion = 2.0)')
      )
      const afterDeleteAst = parseProgram(
        afterCode('@settings(kclVersion = 2.0)')
      )

      const useV3ArmScoping = programUsesKclV3(beforeDeleteAst, getInstance())
      expect(useV3ArmScoping).toBe(false)

      const rewiredAst = rewireAfterDelete(beforeDeleteAst, afterDeleteAst, {
        useV3ArmScoping,
      })

      expect(recast(rewiredAst, getInstance())).toContain(
        'local001 = parent001 + 1'
      )
    })
  })
})

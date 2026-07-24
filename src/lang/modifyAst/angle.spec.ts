import { join } from 'node:path'
import { convertLegacyAngleToAngleDimension } from '@src/lang/modifyAst/angle'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { assertParse, recast } from '@src/lang/wasm'
import type { Program, SourceRange } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, describe, expect, it } from 'vitest'

const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')
let instance: ModuleType

beforeAll(async () => {
  instance = await loadAndInitialiseWasmInstance(WASM_PATH)
})

function legacyAngleRange(ast: Node<Program>): SourceRange {
  const call = ast.body[0]
  if (call.type !== 'ExpressionStatement') throw new Error('Expected sketch')
  const sketch = call.expression
  if (sketch.type !== 'SketchBlock') throw new Error('Expected sketch block')
  const statement = sketch.body.items[0]
  if (statement.type !== 'ExpressionStatement')
    throw new Error('Expected expression')
  const binary = statement.expression
  if (binary.type !== 'BinaryExpression') throw new Error('Expected binary')
  const angle = binary.left
  if (angle.type !== 'CallExpressionKw') throw new Error('Expected angle call')
  return [angle.start, angle.end, angle.moduleId]
}

describe('convertLegacyAngleToAngleDimension', () => {
  it('preserves the line and label expressions while adding the solved sector', () => {
    const ast = assertParse(
      `sketch(on = XY) {
  angle([line1, line2], labelPosition = [10mm, 11mm]) == targetAngle
}`,
      instance
    )
    const result = convertLegacyAngleToAngleDimension(
      ast,
      legacyAngleRange(ast),
      2,
      true,
      instance
    )
    if (err(result)) throw result
    const code = recast(result, instance)
    if (err(code)) throw code

    expect(code).toContain(`angleDimension(
  lines = [line1, line2],
  sector = 2,
  inverse = true,
  labelPosition = [10mm, 11mm],
) == targetAngle`)
  })

  it('omits inverse for the default directed angle', () => {
    const ast = assertParse(
      `sketch(on = XY) {
  angle([line1, line2]) == 60deg
}`,
      instance
    )
    const result = convertLegacyAngleToAngleDimension(
      ast,
      legacyAngleRange(ast),
      1,
      false,
      instance
    )
    if (err(result)) throw result
    const code = recast(result, instance)
    if (err(code)) throw code

    expect(code).toContain(
      'angleDimension(lines = [line1, line2], sector = 1) == 60deg'
    )
    expect(code).not.toContain('inverse')
  })
})

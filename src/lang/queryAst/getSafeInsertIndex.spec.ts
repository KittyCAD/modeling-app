import { assertParse } from '@src/lang/wasm'
import { getSafeInsertIndex } from '@src/lang/queryAst/getSafeInsertIndex'
import { join } from 'path'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

describe('getSafeInsertIndex.test.ts', () => {
  describe(`getSafeInsertIndex`, () => {
    it(`expression with no identifiers`, async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const baseProgram = assertParse(
        `x = 5 + 2
y = 2
z = x + y`,
        instance
      )
      const targetExpr = assertParse(`5`, instance)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(0)
    })
    it(`expression with no identifiers in longer program`, async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const baseProgram = assertParse(
        `x = 5 + 2
    profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0, length = x, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`,
        instance
      )
      const targetExpr = assertParse(`5`, instance)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(0)
    })
    it(`expression with an identifier in the middle`, async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const baseProgram = assertParse(
        `x = 5 + 2
y = 2
z = x + y`,
        instance
      )
      const targetExpr = assertParse(`5 + y`, instance)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
    })
    it(`expression with an identifier at the end`, async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const baseProgram = assertParse(
        `x = 5 + 2
y = 2
z = x + y`,
        instance
      )
      const targetExpr = assertParse(`z * z`, instance)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(3)
    })
    it(`expression with a tag declarator add to end`, async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const baseProgram = assertParse(
        `x = 5 + 2
    profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0, length = x, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`,
        instance
      )
      const targetExpr = assertParse(`5 + segAng(a)`, instance)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
    })
    it(`expression with a tag declarator and variable in the middle`, async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const baseProgram = assertParse(
        `x = 5 + 2
    profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0, length = x, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  y = x + x`,
        instance
      )
      const targetExpr = assertParse(`x + segAng(a)`, instance)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
    })
  })
})

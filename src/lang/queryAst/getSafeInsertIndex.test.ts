import { getSafeInsertIndex } from '@src/lang/queryAst/getSafeInsertIndex'
import { assertParse, initPromise } from '@src/lang/wasm'

beforeAll(async () => {
  await initPromise
})

describe(`getSafeInsertIndex`, () => {
  it(`expression with no identifiers`, () => {
    const baseProgram = assertParse(`x = 5 + 2
y = 2
z = x + y`)
    const targetExpr = assertParse(`5`)
    expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(0)
  })
  it(`expression with no identifiers in longer program`, () => {
    const baseProgram = assertParse(`x = 5 + 2
    profile001 = startProfileAt([0.07, 0], sketch001)
  |> angledLine(angle = 0, length = x, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`)
    const targetExpr = assertParse(`5`)
    expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(0)
  })
  it(`expression with an identifier in the middle`, () => {
    const baseProgram = assertParse(`x = 5 + 2
y = 2
z = x + y`)
    const targetExpr = assertParse(`5 + y`)
    expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
  })
  it(`expression with an identifier at the end`, () => {
    const baseProgram = assertParse(`x = 5 + 2
y = 2
z = x + y`)
    const targetExpr = assertParse(`z * z`)
    expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(3)
  })
  it(`expression with a tag declarator add to end`, () => {
    const baseProgram = assertParse(`x = 5 + 2
    profile001 = startProfileAt([0.07, 0], sketch001)
  |> angledLine(angle = 0, length = x, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`)
    const targetExpr = assertParse(`5 + segAng(a)`)
    expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
  })
  it(`expression with a tag declarator and variable in the middle`, () => {
    const baseProgram = assertParse(`x = 5 + 2
    profile001 = startProfileAt([0.07, 0], sketch001)
  |> angledLine(angle = 0, length = x, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  y = x + x`)
    const targetExpr = assertParse(`x + segAng(a)`)
    expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
  })
})

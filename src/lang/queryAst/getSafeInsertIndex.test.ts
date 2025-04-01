import { assertParse, initPromise } from 'lang/wasm'

import { getSafeInsertIndex } from './getSafeInsertIndex'

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
  |> angledLine([0, x], %, $a)
  |> angledLine([segAng(a) + 90, 5], %)
  |> angledLine([segAng(a), -segLen(a)], %)
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
  |> angledLine([0, x], %, $a)
  |> angledLine([segAng(a) + 90, 5], %)
  |> angledLine([segAng(a), -segLen(a)], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`)
    const targetExpr = assertParse(`5 + segAng(a)`)
    expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
  })
  it(`expression with a tag declarator and variable in the middle`, () => {
    const baseProgram = assertParse(`x = 5 + 2
    profile001 = startProfileAt([0.07, 0], sketch001)
  |> angledLine([0, x], %, $a)
  |> angledLine([segAng(a) + 90, 5], %)
  |> angledLine([segAng(a), -segLen(a)], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  y = x + x`)
    const targetExpr = assertParse(`x + segAng(a)`)
    expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
  })
})

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
})

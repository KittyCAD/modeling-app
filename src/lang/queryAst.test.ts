import { abstractSyntaxTree } from './abstractSyntaxTree'
import { findAllPreviousVariables } from './queryAst'
import { lexer } from './tokeniser'
import { initPromise } from './rust'
import { executor } from './executor'

beforeAll(() => initPromise)

describe('findAllPreviousVariables', () => {
  it('should find all previous variables', () => {
    const code = `const baseThick = 1
const armAngle = 60

const baseThickHalf = baseThick / 2
const halfArmAngle = armAngle / 2

const arrExpShouldNotBeIncluded = [1, 2, 3]
const objExpShouldNotBeIncluded = { a: 1, b: 2, c: 3 }

const part001 = startSketchAt([0, 0])
  |> yLineTo(1, %)
  |> xLine(3.84, %) // selection-range-7ish-before-this

const variableBelowShouldNotBeIncluded = 3

show(part001)`
    const rangeStart = code.indexOf('// selection-range-7ish-before-this') - 7
    const ast = abstractSyntaxTree(lexer(code))
    const programMemory = executor(ast)

    const { variables, bodyPath, insertIndex } = findAllPreviousVariables(
      ast,
      programMemory,
      [rangeStart, rangeStart]
    )
    expect(variables).toEqual({
      baseThick: 1,
      armAngle: 60,
      baseThickHalf: 0.5,
      halfArmAngle: 30,
      // no arrExpShouldNotBeIncluded, variableBelowShouldNotBeIncluded etc
    })
    // there are 4 number variables and 2 non-number variables before the sketch var
    // there the insert index should be 6
    expect(insertIndex).toEqual(6)
    expect(bodyPath).toEqual(['body'])
  })
})

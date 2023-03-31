import { abstractSyntaxTree } from './abstractSyntaxTree'
import {
  findAllPreviousVariables,
  IsNodeSafeToReplace,
  isTypeInValue,
  getNodePathFromSourceRange,
} from './queryAst'
import { lexer } from './tokeniser'
import { initPromise } from './rust'
import { executor } from './executor'
import {
  createArrayExpression,
  createCallExpression,
  createLiteral,
  createPipeSubstitution,
} from './modifyAst'

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
    expect(variables).toEqual([
      { key: 'baseThick', value: 1 },
      { key: 'armAngle', value: 60 },
      { key: 'baseThickHalf', value: 0.5 },
      { key: 'halfArmAngle', value: 30 },
      // no arrExpShouldNotBeIncluded, variableBelowShouldNotBeIncluded etc
    ])
    // there are 4 number variables and 2 non-number variables before the sketch var
    // ∴ the insert index should be 6
    expect(insertIndex).toEqual(6)
    expect(bodyPath).toEqual([['body', '']])
  })
})

describe('testing argIsNotIdentifier', () => {
  const code = `const part001 = startSketchAt([-1.2, 4.83])
|> line([-0.1, 2.57], %)
|> line([3.61, 3.12], %)
|> line([3.12, 1.18], %)
|> line([-0.56, 0.42], %)
|> line([-0.02, 0.72], %)
|> line([2.8, 0], %)
|> line([0.08, -2.44], %)
|> line([-1.76, 0.8], %)
|> angledLine([100 + 100, 3.09], %)
|> angledLine([abc, 3.09], %)
|> angledLine([def('yo'), 3.09], %)
|> angledLine([ghi(%), 3.09], %)
|> angledLine([jkl('yo') + 2, 3.09], %)
const yo = 5 + 6
const yo2 = hmm([identifierGuy + 5])
show(part001)`
  it('find a safe binaryExpression', () => {
    const ast = abstractSyntaxTree(lexer(code))
    const rangeStart = code.indexOf('100 + 100') + 2
    const result = IsNodeSafeToReplace(ast, [rangeStart, rangeStart])
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('BinaryExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe('100 + 100')
  })
  it('find a safe Identifier', () => {
    const ast = abstractSyntaxTree(lexer(code))
    const rangeStart = code.indexOf('abc')
    const result = IsNodeSafeToReplace(ast, [rangeStart, rangeStart])
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('Identifier')
    expect(code.slice(result.value.start, result.value.end)).toBe('abc')
  })
  it('find a safe CallExpression', () => {
    const ast = abstractSyntaxTree(lexer(code))
    const rangeStart = code.indexOf('def')
    const result = IsNodeSafeToReplace(ast, [rangeStart, rangeStart])
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('CallExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe("def('yo')")
  })
  it('find an UNsafe CallExpression, as it has a PipeSubstitution', () => {
    const ast = abstractSyntaxTree(lexer(code))
    const rangeStart = code.indexOf('ghi')
    const range: [number, number] = [rangeStart, rangeStart]
    const result = IsNodeSafeToReplace(ast, range)
    expect(result.isSafe).toBe(false)
    expect(result.value?.type).toBe('CallExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe('ghi(%)')
  })
  it('find an UNsafe Identifier, as it is a callee', () => {
    const ast = abstractSyntaxTree(lexer(code))
    const rangeStart = code.indexOf('ine([2.8,')
    const result = IsNodeSafeToReplace(ast, [rangeStart, rangeStart])
    expect(result.isSafe).toBe(false)
    expect(result.value?.type).toBe('CallExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe(
      'line([2.8, 0], %)'
    )
  })
  it("find a safe BinaryExpression that's assigned to a variable", () => {
    const ast = abstractSyntaxTree(lexer(code))
    const rangeStart = code.indexOf('5 + 6') + 1
    const result = IsNodeSafeToReplace(ast, [rangeStart, rangeStart])
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('BinaryExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe('5 + 6')
  })
  it('find a safe BinaryExpression that has a CallExpression within', () => {
    const ast = abstractSyntaxTree(lexer(code))
    const rangeStart = code.indexOf('jkl') + 1
    const result = IsNodeSafeToReplace(ast, [rangeStart, rangeStart])
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('BinaryExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe(
      "jkl('yo') + 2"
    )
  })
  it('find a safe BinaryExpression within a CallExpression', () => {
    const ast = abstractSyntaxTree(lexer(code))
    const rangeStart = code.indexOf('identifierGuy') + 1
    const result = IsNodeSafeToReplace(ast, [rangeStart, rangeStart])
    expect(result.isSafe).toBe(true)
    expect(result.value?.type).toBe('BinaryExpression')
    expect(code.slice(result.value.start, result.value.end)).toBe(
      'identifierGuy + 5'
    )
  })
  describe('testing isTypeInValue', () => {
    it('it finds the pipeSubstituion', () => {
      const val = createCallExpression('yoyo', [
        createArrayExpression([
          createLiteral(1),
          createCallExpression('yoyo2', [createPipeSubstitution()]),
          createLiteral('hey'),
        ]),
      ])
      expect(isTypeInValue(val, 'PipeSubstitution')).toBe(true)
    })
    it('There is no pipeSubstituion', () => {
      const val = createCallExpression('yoyo', [
        createArrayExpression([
          createLiteral(1),
          createCallExpression('yoyo2', [createLiteral(5)]),
          createLiteral('hey'),
        ]),
      ])
      expect(isTypeInValue(val, 'PipeSubstitution')).toBe(false)
    })
  })
})

describe('testing getNodePathFromSourceRange', () => {
  const code = `const part001 = startSketchAt([0.39, -0.05])
  |> line([0.94, 2.61], %)
  |> line([-0.21, -1.4], %)
show(part001)`
  it('it finds the second line when cursor is put at the end', () => {
    const searchLn = `line([0.94, 2.61], %)`
    const sourceIndex = code.indexOf(searchLn) + searchLn.length
    const ast = abstractSyntaxTree(lexer(code))
    const result = getNodePathFromSourceRange(ast, [sourceIndex, sourceIndex])
    expect(result).toEqual([
      ['body', ''],
      [0, 'index'],
      ['declarations', 'VariableDeclaration'],
      [0, 'index'],
      ['init', ''],
      ['body', 'PipeExpression'],
      [1, 'index'],
    ])
  })
  it('it finds the last line when cursor is put at the end', () => {
    const searchLn = `line([-0.21, -1.4], %)`
    const sourceIndex = code.indexOf(searchLn) + searchLn.length
    const ast = abstractSyntaxTree(lexer(code))
    const result = getNodePathFromSourceRange(ast, [sourceIndex, sourceIndex])
    expect(result).toEqual([
      ['body', ''],
      [0, 'index'],
      ['declarations', 'VariableDeclaration'],
      [0, 'index'],
      ['init', ''],
      ['body', 'PipeExpression'],
      [2, 'index'],
    ])
  })
})

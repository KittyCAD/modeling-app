import { getNodePathFromSourceRange, getNodeFromPath } from './queryAst'
import { Identifier, parse, initPromise } from './wasm'

beforeAll(() => initPromise)

describe('testing getNodePathFromSourceRange', () => {
  it('test it gets the right path for a `lineTo` CallExpression within a SketchExpression', () => {
    const code = `
const myVar = 5
const sk3 = startSketchAt([0, 0])
  |> lineTo([1, 2], %)
  |> lineTo({ to: [3, 4], tag: 'yo' }, %)
  |> close(%)
`
    const subStr = "lineTo({ to: [3, 4], tag: 'yo' }, %)"
    const lineToSubstringIndex = code.indexOf(subStr)
    const sourceRange: [number, number] = [
      lineToSubstringIndex,
      lineToSubstringIndex + subStr.length,
    ]

    const ast = parse(code)
    const nodePath = getNodePathFromSourceRange(ast, sourceRange)
    const { node } = getNodeFromPath<any>(ast, nodePath)

    expect([node.start, node.end]).toEqual(sourceRange)
    expect(node.type).toBe('CallExpression')
  })
  it('gets path right for function definition params', () => {
    const code = `fn cube = (pos, scale) => {
  const sg = startSketchAt(pos)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}

const b1 = cube([0,0], 10)`
    const subStr = 'pos, scale'
    const subStrIndex = code.indexOf(subStr)
    const sourceRange: [number, number] = [
      subStrIndex,
      subStrIndex + 'pos'.length,
    ]

    const ast = parse(code)
    const nodePath = getNodePathFromSourceRange(ast, sourceRange)
    const node = getNodeFromPath<Identifier>(ast, nodePath).node

    expect(nodePath).toEqual([
      ['body', ''],
      [0, 'index'],
      ['declarations', 'VariableDeclaration'],
      [0, 'index'],
      ['init', ''],
      ['params', 'FunctionExpression'],
      [0, 'index'],
    ])
    expect(node.type).toBe('Identifier')
    expect(node.name).toBe('pos')
  })
  it('gets path right for deep within function definition body', () => {
    const code = `fn cube = (pos, scale) => {
  const sg = startSketchAt(pos)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)

  return sg
}

const b1 = cube([0,0], 10)`
    const subStr = 'scale, 0'
    const subStrIndex = code.indexOf(subStr)
    const sourceRange: [number, number] = [
      subStrIndex,
      subStrIndex + 'scale'.length,
    ]

    const ast = parse(code)
    const nodePath = getNodePathFromSourceRange(ast, sourceRange)
    const node = getNodeFromPath<Identifier>(ast, nodePath).node
    expect(nodePath).toEqual([
      ['body', ''],
      [0, 'index'],
      ['declarations', 'VariableDeclaration'],
      [0, 'index'],
      ['init', ''],
      ['body', 'FunctionExpression'],
      ['body', 'FunctionExpression'],
      [0, 'index'],
      ['declarations', 'VariableDeclaration'],
      [0, 'index'],
      ['init', ''],
      ['body', 'PipeExpression'],
      [2, 'index'],
      ['arguments', 'CallExpression'],
      [0, 'index'],
      ['elements', 'ArrayExpression'],
      [0, 'index'],
    ])
    expect(node.type).toBe('Identifier')
    expect(node.name).toBe('scale')
  })
})

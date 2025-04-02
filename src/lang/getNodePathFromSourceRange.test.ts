import type { Name } from '@rust/kcl-lib/bindings/Name'

import { getNodeFromPath } from '@src/lang/queryAst'
import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { topLevelRange } from '@src/lang/util'
import type { Parameter } from '@src/lang/wasm'
import { assertParse, initPromise } from '@src/lang/wasm'
import { err } from '@src/lib/trap'

beforeAll(async () => {
  await initPromise
})

describe('testing getNodePathFromSourceRange', () => {
  it('test it gets the right path for a `lineTo` CallExpression within a SketchExpression', () => {
    const code = `
const myVar = 5
const sk3 = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(endAbsolute = [1, 2])
  |> line(endAbsolute = [3, 4], tag = $yo)
  |> close()
`
    const subStr = 'line(endAbsolute = [3, 4], tag = $yo)'
    const lineToSubstringIndex = code.indexOf(subStr)
    const sourceRange = topLevelRange(
      lineToSubstringIndex,
      lineToSubstringIndex + subStr.length
    )

    const ast = assertParse(code)
    const nodePath = getNodePathFromSourceRange(ast, sourceRange)
    const _node = getNodeFromPath<any>(ast, nodePath)
    if (err(_node)) throw _node
    const { node } = _node

    expect(topLevelRange(node.start, node.end)).toEqual(sourceRange)
    expect(node.type).toBe('CallExpressionKw')
  })
  it('gets path right for function definition params', () => {
    const code = `fn cube = (pos, scale) => {
  const sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}

const b1 = cube([0,0], 10)`
    const subStr = 'pos, scale'
    const subStrIndex = code.indexOf(subStr)
    const sourceRange = topLevelRange(subStrIndex, subStrIndex + 'pos'.length)

    const ast = assertParse(code)
    const nodePath = getNodePathFromSourceRange(ast, sourceRange)
    const _node = getNodeFromPath<Parameter>(ast, nodePath)
    if (err(_node)) throw _node
    const node = _node.node

    expect(nodePath).toEqual([
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', ''],
      ['params', 'FunctionExpression'],
      [0, 'index'],
    ])
    expect(node.type).toBe('Parameter')
    expect(node.identifier.name).toBe('pos')
  })
  it('gets path right for deep within function definition body', () => {
    const code = `fn cube = (pos, scale) => {
  const sg = startSketchOn(XY)
    |> startProfileAt(pos, %)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}

const b1 = cube([0,0], 10)`
    const subStr = 'scale, 0'
    const subStrIndex = code.indexOf(subStr)
    const sourceRange = topLevelRange(subStrIndex, subStrIndex + 'scale'.length)

    const ast = assertParse(code)
    const nodePath = getNodePathFromSourceRange(ast, sourceRange)
    const _node = getNodeFromPath<Name>(ast, nodePath)
    if (err(_node)) throw _node
    const node = _node.node
    expect(nodePath).toEqual([
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', ''],
      ['body', 'FunctionExpression'],
      ['body', 'FunctionExpression'],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', ''],
      ['body', 'PipeExpression'],
      [3, 'index'],
      ['arguments', 'CallExpressionKw'],
      [0, ARG_INDEX_FIELD],
      ['arg', LABELED_ARG_FIELD],
      ['elements', 'ArrayExpression'],
      [0, 'index'],
    ])
    expect(node.type).toBe('Name')
    expect(node.name.name).toBe('scale')
  })
})

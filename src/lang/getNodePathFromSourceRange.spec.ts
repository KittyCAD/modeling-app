import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { assertParse, type Name, type Parameter } from '@src/lang/wasm'
import { join } from 'path'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { topLevelRange } from '@src/lang/util'
import { getNodeFromPath } from '@src/lang/queryAst'
import { err } from '@src/lib/trap'
import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import { expect, describe, it } from 'vitest'
const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

describe('getNodePathFromSourceRange', () => {
  describe('testing getNodePathFromSourceRange', () => {
    it('test it gets the right path for a `lineTo` CallExpression within a SketchExpression', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const code = `
myVar = 5
sk3 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
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

      const ast = assertParse(code, instance)
      const nodePath = getNodePathFromSourceRange(ast, sourceRange)
      const _node = getNodeFromPath<any>(ast, nodePath, instance)
      if (err(_node)) throw _node
      const { node } = _node

      expect(topLevelRange(node.start, node.end)).toEqual(sourceRange)
      expect(node.type).toBe('CallExpressionKw')
    })
    it('gets path right for function definition params', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const code = `fn cube(pos, scale) {
  sg = startSketchOn(XY)
    |> startProfile(at = pos)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}

b1 = cube(pos = [0,0], scale = 10)`
      const subStr = 'pos, scale'
      const subStrIndex = code.indexOf(subStr)
      const sourceRange = topLevelRange(subStrIndex, subStrIndex + 'pos'.length)

      const ast = assertParse(code, instance)
      const nodePath = getNodePathFromSourceRange(ast, sourceRange)
      const _node = getNodeFromPath<Parameter>(ast, nodePath, instance)
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
    it('gets path right for deep within function definition body', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const code = `fn cube(pos, scale) {
  sg = startSketchOn(XY)
    |> startProfile(at = pos)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}

b1 = cube(pos = [0,0], scale = 10)`
      const subStr = 'scale, 0'
      const subStrIndex = code.indexOf(subStr)
      const sourceRange = topLevelRange(
        subStrIndex,
        subStrIndex + 'scale'.length
      )

      const ast = assertParse(code, instance)
      const nodePath = getNodePathFromSourceRange(ast, sourceRange)
      const _node = getNodeFromPath<Name>(ast, nodePath, instance)
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

    it('gets path right for SketchVar initial values', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const code = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var 42mm, var 0mm], end = [var 1mm, var 1mm])
}`

      const subStr = '42mm'
      const subStrIndex = code.indexOf(subStr)
      const sourceRange = topLevelRange(
        subStrIndex,
        subStrIndex + subStr.length
      )

      const ast = assertParse(code, instance)
      const nodePath = getNodePathFromSourceRange(ast, sourceRange)
      expect(nodePath).toContainEqual(['initial', 'SketchVar'])

      const _node = getNodeFromPath<any>(ast, nodePath, instance)
      if (err(_node)) throw _node
      expect(_node.node.type).toBe('NumericLiteral')
    })
  })
})

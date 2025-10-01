import { expect } from 'vitest'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { topLevelRange } from '@src/lang/util'
import type { VariableDeclaration } from '@src/lang/wasm'
import { assertParse, recast } from '@src/lang/wasm'
import { updateCenterRectangleSketch } from '@src/lib/rectangleTool'
import { trap } from '@src/lib/trap'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { join } from 'path'
const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

describe('library rectangleTool helper functions', () => {
  describe('updateCenterRectangleSketch', () => {
    // regression test for https://github.com/KittyCAD/modeling-app/issues/5157
    test('should update AST and source code', async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)

      // Base source code that will be edited in place
      const sourceCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(at = [120.37, 162.76])
|> angledLine(angle = 0, length = 0, tag = $rectangleSegmentA001)
|> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 0, tag = $rectangleSegmentB001)
|> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
`
      // Create ast
      const _ast = assertParse(sourceCode, instance)
      let ast = structuredClone(_ast)

      // Find some nodes and paths to reference
      const sketchSnippet = `startProfile(at = [120.37, 162.76])`
      const start = sourceCode.indexOf(sketchSnippet)
      expect(start).toBeGreaterThanOrEqual(0)
      const sketchRange = topLevelRange(start, start + sketchSnippet.length)
      const sketchPathToNode = getNodePathFromSourceRange(ast, sketchRange)
      const _node = getNodeFromPath<VariableDeclaration>(
        ast,
        sketchPathToNode || [],
        'VariableDeclaration'
      )
      if (trap(_node)) return
      const sketchInit = _node.node?.declaration.init

      // Hard code inputs that a user would have taken with their mouse
      const x = 40
      const y = 60
      const rectangleOrigin = [120, 180]
      const tags: [string, string, string] = [
        'rectangleSegmentA001',
        'rectangleSegmentB001',
        'rectangleSegmentC001',
      ]

      // Update the ast
      if (sketchInit.type === 'PipeExpression') {
        const maybeErr = updateCenterRectangleSketch(
          sketchInit,
          x,
          y,
          tags[0],
          rectangleOrigin[0],
          rectangleOrigin[1]
        )
        expect(maybeErr).toEqual(undefined)
      }

      // ast is edited in place from the updateCenterRectangleSketch
      const expectedSourceCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(at = [80, 120])
  |> angledLine(angle = 0, length = 80, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 120, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`
      const recasted = recast(ast, instance)
      expect(recasted).toEqual(expectedSourceCode)
    })
  })
})

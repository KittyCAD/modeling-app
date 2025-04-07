import { expect } from 'vitest'

import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { topLevelRange } from '@src/lang/util'
import type { VariableDeclaration } from '@src/lang/wasm'
import { assertParse, initPromise, recast } from '@src/lang/wasm'
import { updateCenterRectangleSketch } from '@src/lib/rectangleTool'
import { trap } from '@src/lib/trap'

beforeAll(async () => {
  await initPromise
})

describe('library rectangleTool helper functions', () => {
  describe('updateCenterRectangleSketch', () => {
    // regression test for https://github.com/KittyCAD/modeling-app/issues/5157
    test('should update AST and source code', async () => {
      // Base source code that will be edited in place
      const sourceCode = `sketch001 = startSketchOn(XZ)
|> startProfileAt([120.37, 162.76], %)
|> angledLine(angle = 0, length = 0, tag = $rectangleSegmentA001)
|> angledLine(angle = segAng(rectangleSegmentA001) + 90, length = 0, tag = $rectangleSegmentB001)
|> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
`
      // Create ast
      const _ast = assertParse(sourceCode)
      let ast = structuredClone(_ast)

      // Find some nodes and paths to reference
      const sketchSnippet = `startProfileAt([120.37, 162.76], %)`
      const sketchRange = topLevelRange(
        sourceCode.indexOf(sketchSnippet),
        sourceCode.indexOf(sketchSnippet) + sketchSnippet.length
      )
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
        updateCenterRectangleSketch(
          sketchInit,
          x,
          y,
          tags[0],
          rectangleOrigin[0],
          rectangleOrigin[1]
        )
      }

      // ast is edited in place from the updateCenterRectangleSketch
      const expectedSourceCode = `sketch001 = startSketchOn(XZ)
  |> startProfileAt([120.37, 80], %)
  |> angledLine(angle = 0, length = 0, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90, length = 0, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`
      const recasted = recast(ast)
      expect(recasted).toEqual(expectedSourceCode)
    })
  })
})

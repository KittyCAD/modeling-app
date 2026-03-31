import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { addTagForSketchOnFace } from '@src/lang/std/sketchTaggingHelpers'
import { topLevelRange } from '@src/lang/util'
import { assertParse, recast } from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import type RustContext from '@src/lib/rustContext'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})

afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

describe('testing addTagForSketchOnFace', () => {
  it('adds a segment tag to a sketch line helper', async () => {
    const originalLine = 'line(endAbsolute = [-1.59, -1.54])'
    // Enable rotations #152
    const genCode = (line: string) => `mySketch001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  // |> rx(45)
  |> ${line}
  |> line(endAbsolute = [0.46, -5.82])
`
    const code = genCode(originalLine)
    const ast = assertParse(code, instanceInThisFile)
    await enginelessExecutor(ast, rustContextInThisFile)
    const sourceStart = code.indexOf(originalLine)
    const sourceRange = topLevelRange(
      sourceStart,
      sourceStart + originalLine.length
    )
    if (err(ast)) return ast
    const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
    const sketchOnFaceRetVal = addTagForSketchOnFace(
      {
        pathToNode,
        node: ast,
        wasmInstance: instanceInThisFile,
      },
      'lineTo',
      null,
      instanceInThisFile
    )
    if (err(sketchOnFaceRetVal)) return sketchOnFaceRetVal

    const { modifiedAst } = sketchOnFaceRetVal
    const expectedCode = genCode(
      'line(endAbsolute = [-1.59, -1.54], tag = $seg01)'
    )
    expect(recast(modifiedAst, instanceInThisFile)).toBe(expectedCode)
  })

  const chamferTestCases = [
    {
      desc: 'chamfer in pipeExpr',
      originalChamfer: `  |> chamfer(length = 30, tags = [seg01, getOppositeEdge(seg01)])`,
      expectedChamfer: `  |> chamfer(length = 30, tags = [getOppositeEdge(seg01)], tag = $seg03)
  |> chamfer(length = 30, tags = [seg01])`,
    },
    {
      desc: 'chamfer with its own variable',
      originalChamfer: `chamf = chamfer(
       extrude001,
       length = 30,
       tags = [seg01, getOppositeEdge(seg01)],
     )`,
      expectedChamfer: `chamf = chamfer(
       extrude001,
       length = 30,
       tags = [getOppositeEdge(seg01)],
       tag = $seg03,
     )
  |> chamfer(length = 30, tags = [seg01])`,
    },
  ] as const

  chamferTestCases.forEach(({ originalChamfer, expectedChamfer, desc }) => {
    it(`can break up chamfers in order to add tags - ${desc}`, async () => {
      const genCode = (insertCode: string) => `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [75.8, 317.2]) // [$startCapTag, $EndCapTag]
  |> angledLine(angle = 0, length = 268.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 217.26, tag = $seg01)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(sketch001, length = 100)
${insertCode}
`
      const code = genCode(originalChamfer)
      const ast = assertParse(code, instanceInThisFile)
      await enginelessExecutor(ast, rustContextInThisFile)
      const sourceStart = code.indexOf(originalChamfer)
      const extraChars = originalChamfer.indexOf('chamfer')
      const sourceRange = topLevelRange(
        sourceStart + extraChars,
        sourceStart + originalChamfer.length - extraChars
      )

      if (err(ast)) throw ast
      const pathToNode = getNodePathFromSourceRange(ast, sourceRange)
      const sketchOnFaceRetVal = addTagForSketchOnFace(
        {
          pathToNode,
          node: ast,
          wasmInstance: instanceInThisFile,
        },
        'chamfer',
        {
          type: 'edgeCut',
          subType: 'opposite',
          tagName: 'seg01',
        },
        instanceInThisFile
      )
      if (err(sketchOnFaceRetVal)) throw sketchOnFaceRetVal
      expect(recast(sketchOnFaceRetVal.modifiedAst, instanceInThisFile)).toBe(
        genCode(expectedChamfer)
      )
    })
  })
})

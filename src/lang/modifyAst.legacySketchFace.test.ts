import { join } from 'path'

import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import {
  addTagToExtrudedFaceSketchSegment,
  sketchBlockOnExtrudedFace,
} from '@src/lang/modifyAst'
import { addTagForSketchOnFace } from '@src/lang/std/sketch'
import { assertParse, recast } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, describe, expect, test } from 'vitest'

const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

let instance: ModuleType

beforeAll(async () => {
  instance = await loadAndInitialiseWasmInstance(WASM_PATH)
})

describe('temporary legacy sketch-on-face helpers', () => {
  test('sketchBlockOnExtrudedFace tags the legacy wall segment and inserts a sketch block', () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-3.5, -2.23])
  |> line(end = [4.53, 5.73])
  |> line(end = [5.18, -3.74])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)
`
    const ast = assertParse(code, instance)

    const segmentSnippet =
      'line(endAbsolute = [profileStartX(%), profileStartY(%)])'
    const segmentPathToNode = getNodePathFromSourceRange(ast, [
      code.indexOf(segmentSnippet),
      code.indexOf(segmentSnippet) + segmentSnippet.length,
      0,
    ])
    const extrudeSnippet = 'extrude(profile001, length = 5)'
    const extrudePathToNode = getNodePathFromSourceRange(ast, [
      code.indexOf(extrudeSnippet),
      code.indexOf(extrudeSnippet) + extrudeSnippet.length,
      0,
    ])

    const result = sketchBlockOnExtrudedFace(
      ast,
      segmentPathToNode,
      extrudePathToNode,
      addTagForSketchOnFace,
      instance
    )
    if (err(result)) throw result

    const newCode = recast(result.modifiedAst, instance)
    expect(newCode).toContain(
      'line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)'
    )
    expect(newCode).toContain(
      `extrude001 = extrude(profile001, length = 5)
sketch002 = sketch(on = faceOf(extrude001, face = seg01)) {
}`
    )

    const insertedSketchBlock = getNodeFromPath<any>(
      result.modifiedAst,
      result.pathToNode,
      instance
    )
    if (err(insertedSketchBlock)) throw insertedSketchBlock
    expect(insertedSketchBlock.node.type).toBe('SketchBlock')
  })

  test('addTagToExtrudedFaceSketchSegment returns cap tags without mutating the source', () => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-3.5, -2.23])
  |> line(end = [4.53, 5.73])
  |> line(end = [5.18, -3.74])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)
`
    const ast = assertParse(code, instance)
    const profileSnippet = 'startProfile(sketch001, at = [-3.5, -2.23])'
    const profilePathToNode = getNodePathFromSourceRange(ast, [
      code.indexOf(profileSnippet),
      code.indexOf(profileSnippet) + profileSnippet.length,
      0,
    ])

    const result = addTagToExtrudedFaceSketchSegment(
      ast,
      profilePathToNode,
      addTagForSketchOnFace,
      instance,
      { type: 'cap', subType: 'end' }
    )
    if (err(result)) throw result

    expect(result.tagName).toBe('END')
    expect(recast(result.modifiedAst, instance)).toBe(recast(ast, instance))
  })
})

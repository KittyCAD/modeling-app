import { getTagDeclaratorsInProgram } from '@src/lang/queryAst/getTagDeclaratorsInProgram'
import { assertParse } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { join } from 'path'
import { expect } from 'vitest'
const WASM_PATH = join(process.cwd(), 'public/kcl_wasm_lib_bg.wasm')

describe('getTagDeclaratorsInProgram', () => {
  function tagDeclaratorWithIndex(
    value: string,
    start: number,
    end: number,
    bodyIndex: number
  ) {
    return {
      tag: {
        type: 'TagDeclarator',
        value,
        start,
        end,
        moduleId: 0,
        commentStart: start,
      },
      bodyIndex,
    }
  }
  describe(`getTagDeclaratorsInProgram`, () => {
    it(`finds no tag declarators in an empty program`, async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const tagDeclarators = getTagDeclaratorsInProgram(
        assertParse('', instance)
      )
      expect(tagDeclarators).toEqual([])
    })
    it(`finds a single tag declarators in a small program`, async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const tagDeclarators = getTagDeclaratorsInProgram(
        assertParse(
          `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> angledLine(angle = 0, length = 11, tag = $a)`,
          instance
        )
      )
      expect(tagDeclarators).toEqual([tagDeclaratorWithIndex('a', 126, 128, 1)])
    })
    it(`finds multiple tag declarators in a small program`, async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const program = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0, length = 11, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 11.17, tag = $b)
  |> angledLine(angle = segAng(a), length = -segLen(a), tag = $c)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
      const tagDeclarators = getTagDeclaratorsInProgram(
        assertParse(program, instance)
      )
      expect(tagDeclarators).toEqual([
        tagDeclaratorWithIndex('a', 129, 131, 1),
        tagDeclaratorWithIndex('b', 195, 197, 1),
        tagDeclaratorWithIndex('c', 261, 263, 1),
      ])
    })
    it(`finds tag declarators at different indices`, async () => {
      const instance = await loadAndInitialiseWasmInstance(WASM_PATH)
      const program = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0, length = 11, tag = $a)
profile002 = angledLine(profile001, angle = segAng(a) + 90, length = 11.17, tag = $b)
  |> angledLine(angle = segAng(a), length = -segLen(a), tag = $c)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
      const tagDeclarators = getTagDeclaratorsInProgram(
        assertParse(program, instance)
      )
      expect(tagDeclarators).toEqual([
        tagDeclaratorWithIndex('a', 129, 131, 1),
        tagDeclaratorWithIndex('b', 215, 217, 2),
        tagDeclaratorWithIndex('c', 281, 283, 2),
      ])
    })
  })
})

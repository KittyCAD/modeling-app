import { assertParse } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import { enginelessExecutor } from '@src/lib/testHelpers'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let rustContextInThisFile: RustContext = null!
let worldInThisFile:
  | Awaited<ReturnType<typeof buildTheWorldAndNoEngineConnection>>
  | undefined

/**
 * Every it test could build the world, but this is too resource intensive.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, rustContext, ...world } =
    await buildTheWorldAndNoEngineConnection()
  instanceInThisFile = instance
  rustContextInThisFile = rustContext
  worldInThisFile = { instance, rustContext, ...world }
})

afterAll(() => {
  worldInThisFile?.engineCommandManager.tearDown()
  worldInThisFile?.commandBarActor.stop()
  worldInThisFile?.settingsActor.stop()
})

describe('testing angledLineThatIntersects', () => {
  it('angledLineThatIntersects should intersect with another line', async () => {
    const code = (offset: string) => `part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [2, 2], tag = $yo)
  |> line(endAbsolute = [3, 1])
  |> angledLineThatIntersects(
       angle = 180deg,
       intersectTag = yo,
       offset = ${offset},
       tag = $yo2,
     )
intersect = segEndX(yo2)`
    const execState = await enginelessExecutor(
      assertParse(code('-1'), instanceInThisFile),
      rustContextInThisFile
    )
    const intersect = execState.variables['intersect']
    expect(intersect?.type).toBe('Number')
    if (intersect?.type !== 'Number') {
      throw new Error('Expected KCL value Number')
    }
    expect(intersect.value).toBe(1 + Math.sqrt(2))
    const noOffset = await enginelessExecutor(
      assertParse(code('0'), instanceInThisFile),
      rustContextInThisFile
    )
    const noOffsetIntersect = noOffset.variables['intersect']
    expect(noOffsetIntersect?.type).toBe('Number')
    if (noOffsetIntersect?.type !== 'Number') {
      throw new Error('Expected KCL value Number')
    }
    expect(noOffsetIntersect.value).toBeCloseTo(1)
  })
})

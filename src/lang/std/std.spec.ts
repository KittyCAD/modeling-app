import { assertParse } from '@src/lang/wasm'
import { enginelessExecutor } from '@src/lib/testHelpers'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import type RustContext from '@src/lib/rustContext'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import { afterAll, expect, beforeEach, describe, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

/**
 * Every it test could build the world and connect to the engine but this is too resource intensive and will
 * spam engine connections.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
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
    expect(execState.variables['intersect']?.value).toBe(1 + Math.sqrt(2))
    const noOffset = await enginelessExecutor(
      assertParse(code('0'), instanceInThisFile),
      rustContextInThisFile
    )
    expect(noOffset.variables['intersect']?.value).toBeCloseTo(1)
  })
})
